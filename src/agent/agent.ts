import { create } from 'zustand';
import { produce } from 'immer';
import type { Project } from '../model/types';
import { beatToBar } from '../model/project';
import { getProject, useDaw } from '../state/store';
import { useSettings, aiAvailable } from '../state/settings';
import { streamGenerate, explainError, type Content, type Part } from './llm';
import { describeProject, describeClipNotes } from './context';
import { systemPrompt } from './prompts';
import { runTool, toolDeclarations, type AgentMode, type PlanStep } from './tools';
import { diffProjects } from './diff';
import { findClip } from '../model/project';
import { compactHistory, CONTEXT_BUDGET, historySize, summarizeHistory, withProjectState } from './history';
import { clearAudioReviews } from './audioReviews';

// The agent loop: stream a turn, run whatever tools the model calls, feed results
// back, repeat until it answers in plain text. All edits land in one undo step and
// get a reviewable change summary — Cursor's accept/reject, for music.

const MAX_TURNS = 48;

export type ChatItem =
  | { kind: 'user'; id: string; text: string; checkpoint: Project; focus?: string; steering?: 'queued' | 'applied' | 'cancelled' }
  | { kind: 'assistant'; id: string; text: string; thinking: string; streaming: boolean }
  | { kind: 'tool'; id: string; name: string; args: Record<string, unknown>; status: 'running' | 'done' | 'error'; summary: string; heard?: string; sampleIds?: string[]; clipIds?: string[]; audioReviewIds?: string[] }
  | { kind: 'plan'; id: string; steps: PlanStep[] }
  | { kind: 'changes'; id: string; lines: string[]; checkpoint: Project; state: 'pending' | 'kept' | 'reverted' }
  | { kind: 'error'; id: string; text: string };

interface AgentState {
  items: ChatItem[];
  history: Content[];
  running: boolean;
  mode: AgentMode;
  status: string;
  abort: AbortController | null;
  tokens: { input: number; output: number };
  steering: Array<{ id: string; text: string; opts: RunOptions }>;
  context: { chars: number; compactions: number };
  setMode: (m: AgentMode) => void;
  clear: () => void;
}

export const useAgent = create<AgentState>((set) => ({
  items: [],
  history: [],
  running: false,
  mode: 'agent',
  status: '',
  abort: null,
  tokens: { input: 0, output: 0 },
  steering: [],
  context: { chars: 0, compactions: 0 },
  setMode: (mode) => set({ mode }),
  clear: () => {
    useAgent.getState().abort?.abort();
    useDaw.getState().endTransaction();
    clearAudioReviews();
    set({ items: [], history: [], tokens: { input: 0, output: 0 }, steering: [], context: { chars: 0, compactions: 0 }, running: false, abort: null, status: '' });
  },
}));

let seq = 0;
const nid = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

function push(item: ChatItem) {
  useAgent.setState((s) => ({ items: [...s.items, item] }));
}

function patch(id: string, fn: (it: ChatItem) => ChatItem) {
  useAgent.setState((s) => ({ items: s.items.map((it) => (it.id === id ? fn(it) : it)) }));
}

function setStatus(status: string) {
  useAgent.setState({ status });
}

export interface RunOptions {
  /** Restrict attention to these clips (inline Ctrl+K edits). */
  focusClipIds?: string[];
  /** Extra context, e.g. a reference-track breakdown. */
  attachments?: string[];
  mode?: AgentMode;
}

function focusContext(p: Project, clipIds: string[]): { text: string; label: string } {
  const parts: string[] = [];
  const names: string[] = [];
  for (const id of clipIds) {
    const f = findClip(p, id);
    if (!f) continue;
    names.push(`“${f.clip.name}” on ${f.track.name}`);
    if (f.clip.type === 'midi') parts.push(describeClipNotes(p, f.track, f.clip));
    else parts.push(`${f.clip.id} audio clip "${f.clip.name}" on ${f.track.id} "${f.track.name}", bars ${beatToBar(p, f.clip.start)}–${beatToBar(p, f.clip.start + f.clip.length)}`);
  }
  return {
    text: `<selection>\nThe user selected these clips. Apply the request to them (edit in place; keep their position unless asked) and leave the rest of the song alone unless the request clearly needs it.\n${parts.join('\n\n')}\n</selection>`,
    label: names.join(', '),
  };
}

/** Follow-ups stay in this run and its undo transaction. */
export function steerAgent(text: string, opts: RunOptions = {}): boolean {
  const s = useAgent.getState();
  if (!s.running || s.abort?.signal.aborted || !text.trim()) return false;
  const id = nid();
  const p = getProject();
  const focus = opts.focusClipIds?.length ? focusContext(p, opts.focusClipIds) : null;
  useAgent.setState((state) => ({
    items: [...state.items, { kind: 'user', id, text: text.trim(), checkpoint: p, focus: focus?.label, steering: 'queued' }],
    steering: [...state.steering, { id, text: text.trim(), opts }],
  }));
  return true;
}

export async function runAgent(text: string, opts: RunOptions = {}) {
  const st = useAgent.getState();
  if (!text.trim()) return;
  if (st.running) { steerAgent(text, opts); return; }
  const avail = aiAvailable();
  if (!avail.ok) {
    push({ kind: 'error', id: nid(), text: avail.reason! });
    window.dispatchEvent(new Event('vibe:open-settings'));
    return;
  }
  const mode = opts.mode ?? st.mode;
  const abort = new AbortController();
  const checkpoint = getProject();
  const focus = opts.focusClipIds?.length ? focusContext(checkpoint, opts.focusClipIds) : null;
  push({ kind: 'user', id: nid(), text: text.trim(), checkpoint, focus: focus?.label });
  useAgent.setState({ running: true, abort, status: 'Thinking…' });
  const daw = useDaw.getState();
  if (mode === 'agent') daw.beginTransaction(`Agent: ${text.trim().slice(0, 48)}`);

  const userParts: Part[] = [{
    text: [
      text.trim(),
      ...(opts.attachments ?? []),
      focus?.text ?? '',
      `<project_state>\n${describeProject(checkpoint)}\n</project_state>`,
    ].filter(Boolean).join('\n\n'),
  }];
  let history: Content[] = [...useAgent.getState().history, { role: 'user', parts: userParts }];
  const settings = useSettings.getState();
  const tools = toolDeclarations(mode);
  const system = systemPrompt(mode) + '\n\nUse manage_context to inspect the context budget or compact your working memory with a concise summary of goals, steering, decisions, useful sample/track ids, listening findings and unfinished work. Automatic compaction also runs when needed. Latest steering supersedes conflicting earlier instructions; skipped tool calls were not executed.';
  let planId: string | null = null;
  let malformedRetried = false;
  let goal = text;
  let requestedSummary: string | undefined;
  const active = () => useAgent.getState().abort === abort && getProject().id === checkpoint.id;
  const checkActive = () => { if (!active() || abort.signal.aborted) throw new DOMException('Aborted', 'AbortError'); };
  const applySteering = () => {
    const queued = useAgent.getState().steering;
    if (!queued.length) return;
    const parts: Part[] = queued.map((q) => ({ text: [
      `Latest steering from the user: ${q.text}`,
      ...(q.opts.attachments ?? []),
      q.opts.focusClipIds?.length ? focusContext(getProject(), q.opts.focusClipIds).text : '',
    ].filter(Boolean).join('\n') }));
    const last = history[history.length - 1];
    if (last?.role === 'user') history = [...history.slice(0, -1), { ...last, parts: [...last.parts, ...parts] }];
    else history = [...history, { role: 'user', parts }];
    goal = `${text}\nSteering:\n${(goal.slice(text.length) + '\n' + queued.map((q) => q.text).join('\n')).slice(-8000)}`;
    const ids = new Set(queued.map((q) => q.id));
    useAgent.setState((s) => ({ steering: [], items: s.items.map((i) => i.kind === 'user' && ids.has(i.id) ? { ...i, steering: 'applied' } : i) }));
  };

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      checkActive();
      applySteering();
      const compacted = compactHistory(withProjectState(history, describeProject(getProject())), { force: requestedSummary !== undefined, summary: requestedSummary });
      requestedSummary = undefined;
      history = compacted.history;
      useAgent.setState((s) => ({ context: { chars: compacted.chars, compactions: s.context.compactions + Number(compacted.compacted) } }));
      const aid = nid();
      push({ kind: 'assistant', id: aid, text: '', thinking: '', streaming: true });
      setStatus(turn === 0 ? 'Thinking…' : 'Working…');
      const res = await streamGenerate(
        { system, contents: history, tools, thinking: settings.thinking, signal: abort.signal },
        {
          onText: (d) => { if (active()) patch(aid, (it) => (it.kind === 'assistant' ? { ...it, text: it.text + d } : it)); },
          onThought: (d) => { if (active()) patch(aid, (it) => (it.kind === 'assistant' ? { ...it, thinking: it.thinking + d } : it)); },
        },
      );
      checkActive();
      patch(aid, (it) => (it.kind === 'assistant' ? { ...it, streaming: false } : it));
      useAgent.setState((s) => ({ tokens: { input: s.tokens.input + (res.usage?.input ?? 0), output: s.tokens.output + (res.usage?.output ?? 0) } }));
      // Drop empty assistant bubbles (turns that were only tool calls).
      const item = useAgent.getState().items.find((x) => x.id === aid);
      if (item && item.kind === 'assistant' && !item.text.trim() && !item.thinking.trim()) {
        useAgent.setState((s) => ({ items: s.items.filter((x) => x.id !== aid) }));
      }
      if (!res.content.parts.length) {
        if (useAgent.getState().steering.length) continue;
        if (res.finishReason === 'MALFORMED_FUNCTION_CALL' && !malformedRetried) {
          // Nudge once instead of failing the whole run.
          malformedRetried = true;
          const nudge: Part = { text: 'Your last tool call was malformed. Call the tool again with valid JSON arguments that match its schema.' };
          const last = history[history.length - 1];
          history = last?.role === 'user' ? [...history.slice(0, -1), { ...last, parts: [...last.parts, nudge] }] : [...history, { role: 'user', parts: [nudge] }];
          continue;
        }
        if (res.finishReason && res.finishReason !== 'STOP') throw new Error(`The model stopped early (${res.finishReason}).`);
        break;
      }
      history = [...history, res.content];
      const calls = res.content.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
      if (!calls.length) {
        if (useAgent.getState().steering.length) continue;
        break;
      }

      const responses: Part[] = [];
      for (const call of calls) {
        checkActive();
        if (useAgent.getState().steering.length) {
          responses.push({ functionResponse: { name: call.name, response: { error: 'Skipped because the user supplied new steering. Re-plan before making more changes.' }, ...(call.id ? { id: call.id } : {}) } });
          continue;
        }
        const tid = nid();
        push({ kind: 'tool', id: tid, name: call.name, args: call.args ?? {}, status: 'running', summary: '' });
        setStatus(statusFor(call.name));
        const out = await runTool(call.name, call.args ?? {}, { signal: abort.signal, goal, context: { chars: historySize(history), budget: CONTEXT_BUDGET } }, mode);
        checkActive();
        if (out.contextSummary !== undefined) requestedSummary = out.contextSummary;
        const failed = 'error' in out.result;
        patch(tid, (it) => (it.kind === 'tool' ? { ...it, status: failed ? 'error' : 'done', summary: out.summary, heard: out.heard, sampleIds: out.sampleIds, clipIds: out.clipIds, audioReviewIds: out.audioReviewIds } : it));
        if (out.plan) {
          if (planId) patch(planId, (it) => (it.kind === 'plan' ? { ...it, steps: out.plan! } : it));
          else { planId = nid(); push({ kind: 'plan', id: planId, steps: out.plan }); }
          // The plan card replaces the tool row.
          useAgent.setState((s) => ({ items: s.items.filter((x) => x.id !== tid) }));
        }
        responses.push({ functionResponse: { name: call.name, response: out.result, ...(call.id ? { id: call.id } : {}) } });
      }
      history = [...history, { role: 'user', parts: responses }];
      if (turn === MAX_TURNS - 1) push({ kind: 'error', id: nid(), text: 'Stopped after many steps. Say “continue” to keep going.' });
    }
  } catch (e) {
    if (!active()) return;
    const aborted = abort.signal.aborted || (e as Error)?.name === 'AbortError';
    push({ kind: 'error', id: nid(), text: aborted ? 'Stopped.' : explainError(e) });
    // Close any dangling function calls so the next turn is valid.
    const last = history[history.length - 1];
    if (last?.role === 'model' && last.parts.some((p) => p.functionCall)) {
      history = [...history, { role: 'user', parts: last.parts.filter((p) => p.functionCall).map((p) => ({ functionResponse: { name: p.functionCall!.name, response: { error: aborted ? 'Stopped by user' : 'Failed' }, ...(p.functionCall!.id ? { id: p.functionCall!.id } : {}) } })) }];
    }
  } finally {
    if (active()) {
    // Also bound persisted conversation memory when this run finishes or stops.
    try { history = compactHistory(history).history; } catch { history = [{ role: 'user', parts: [{ text: `<context_summary>\n${summarizeHistory(history)}\n</context_summary>` }] }]; }
    useAgent.setState((s) => ({
      running: false,
      abort: null,
      status: '',
      history,
      steering: [],
      items: s.items.map((it) => (it.kind === 'user' && it.steering === 'queued' ? { ...it, steering: 'cancelled' } : it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'error', summary: it.summary || 'Interrupted' } : it.kind === 'assistant' && it.streaming ? { ...it, streaming: false } : it)),
    }));
    if (mode === 'agent') {
      useDaw.getState().endTransaction();
      const after = getProject();
      const diff = diffProjects(checkpoint, after);
      if (diff.lines.length) push({ kind: 'changes', id: nid(), lines: diff.lines, checkpoint, state: 'pending' });
    }
    }
  }
}

function statusFor(tool: string): string {
  switch (tool) {
    case 'listen': return 'Listening to the mix…';
    case 'audition_samples': return 'Auditioning samples…';
    case 'design_sound': return 'Designing a sound…';
    case 'bounce_to_sample': return 'Bouncing audio…';
    case 'write_drums': return 'Programming drums…';
    case 'write_notes': return 'Writing notes…';
    case 'search_samples': return 'Digging through samples…';
    default: return 'Working…';
  }
}

export function stopAgent() {
  useAgent.getState().abort?.abort();
}

/** Accept: clear the "unreviewed" highlight on AI-made clips. */
export function keepChanges(itemId: string) {
  useDaw.setState((s) => ({
    project: produce(s.project, (d) => { for (const t of d.tracks) for (const c of t.clips) if (c.aiPending) delete c.aiPending; }),
  }));
  patch(itemId, (it) => (it.kind === 'changes' ? { ...it, state: 'kept' } : it));
}

/** Reject: restore the project to how it was before that agent run (undoable). */
export function revertTo(checkpoint: Project, itemId?: string) {
  stopAgent();
  useDaw.getState().replaceProject(checkpoint, { keepHistory: true, label: 'Revert agent changes' });
  if (itemId) patch(itemId, (it) => (it.kind === 'changes' ? { ...it, state: 'reverted' } : it));
}

export function keepAllPending() {
  const items = useAgent.getState().items.filter((i) => i.kind === 'changes' && i.state === 'pending');
  for (const i of items) keepChanges(i.id);
}
