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

// The agent loop: stream a turn, run whatever tools the model calls, feed results
// back, repeat until it answers in plain text. All edits land in one undo step and
// get a reviewable change summary — Cursor's accept/reject, for music.

const MAX_TURNS = 48;
const HISTORY_CHAR_BUDGET = 260_000;

export type ChatItem =
  | { kind: 'user'; id: string; text: string; checkpoint: Project; focus?: string }
  | { kind: 'assistant'; id: string; text: string; thinking: string; streaming: boolean }
  | { kind: 'tool'; id: string; name: string; args: Record<string, unknown>; status: 'running' | 'done' | 'error'; summary: string; heard?: string; sampleIds?: string[]; clipIds?: string[] }
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
  setMode: (mode) => set({ mode }),
  clear: () => set({ items: [], history: [], tokens: { input: 0, output: 0 } }),
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

/** Keep the conversation within budget by shrinking old tool payloads and project snapshots. */
function pruneHistory(history: Content[]): Content[] {
  let size = JSON.stringify(history).length;
  if (size <= HISTORY_CHAR_BUDGET) return history;
  const out = history.map((c) => ({ ...c, parts: [...c.parts] }));
  for (let i = 0; i < out.length - 6 && size > HISTORY_CHAR_BUDGET; i++) {
    out[i].parts = out[i].parts.map((part): Part => {
      if (part.functionResponse) {
        const r = part.functionResponse.response as Record<string, unknown>;
        const keep = 'error' in r ? { error: r.error } : { ok: true, note: 'older result trimmed' };
        return { functionResponse: { ...part.functionResponse, response: keep } };
      }
      if (part.text && part.text.includes('<project_state>')) {
        return { ...part, text: part.text.replace(/<project_state>[\s\S]*?<\/project_state>/, '<project_state>(outdated snapshot removed)</project_state>') };
      }
      if (part.inlineData) return { text: '(audio removed)' };
      return part;
    });
    size = JSON.stringify(out).length;
  }
  return out;
}

export async function runAgent(text: string, opts: RunOptions = {}) {
  const st = useAgent.getState();
  if (st.running || !text.trim()) return;
  const avail = aiAvailable();
  if (!avail.ok) {
    push({ kind: 'error', id: nid(), text: avail.reason! });
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
  let history = pruneHistory([...useAgent.getState().history, { role: 'user', parts: userParts }]);
  const settings = useSettings.getState();
  const tools = toolDeclarations(mode);
  const system = systemPrompt(mode);
  let planId: string | null = null;
  let malformedRetried = false;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const aid = nid();
      push({ kind: 'assistant', id: aid, text: '', thinking: '', streaming: true });
      setStatus(turn === 0 ? 'Thinking…' : 'Working…');
      const res = await streamGenerate(
        { system, contents: history, tools, thinking: settings.thinking, signal: abort.signal },
        {
          onText: (d) => patch(aid, (it) => (it.kind === 'assistant' ? { ...it, text: it.text + d } : it)),
          onThought: (d) => patch(aid, (it) => (it.kind === 'assistant' ? { ...it, thinking: it.thinking + d } : it)),
        },
      );
      patch(aid, (it) => (it.kind === 'assistant' ? { ...it, streaming: false } : it));
      useAgent.setState((s) => ({ tokens: { input: s.tokens.input + (res.usage?.input ?? 0), output: s.tokens.output + (res.usage?.output ?? 0) } }));
      // Drop empty assistant bubbles (turns that were only tool calls).
      const item = useAgent.getState().items.find((x) => x.id === aid);
      if (item && item.kind === 'assistant' && !item.text.trim() && !item.thinking.trim()) {
        useAgent.setState((s) => ({ items: s.items.filter((x) => x.id !== aid) }));
      }
      if (!res.content.parts.length) {
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
      if (!calls.length) break;

      const responses: Part[] = [];
      for (const call of calls) {
        if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const tid = nid();
        push({ kind: 'tool', id: tid, name: call.name, args: call.args ?? {}, status: 'running', summary: '' });
        setStatus(statusFor(call.name));
        const out = await runTool(call.name, call.args ?? {}, { signal: abort.signal, goal: text }, mode);
        const failed = 'error' in out.result;
        patch(tid, (it) => (it.kind === 'tool' ? { ...it, status: failed ? 'error' : 'done', summary: out.summary, heard: out.heard, sampleIds: out.sampleIds, clipIds: out.clipIds } : it));
        if (out.plan) {
          if (planId) patch(planId, (it) => (it.kind === 'plan' ? { ...it, steps: out.plan! } : it));
          else { planId = nid(); push({ kind: 'plan', id: planId, steps: out.plan }); }
          // The plan card replaces the tool row.
          useAgent.setState((s) => ({ items: s.items.filter((x) => x.id !== tid) }));
        }
        responses.push({ functionResponse: { name: call.name, response: out.result, ...(call.id ? { id: call.id } : {}) } });
      }
      history = pruneHistory([...history, { role: 'user', parts: responses }]);
      if (turn === MAX_TURNS - 1) push({ kind: 'error', id: nid(), text: 'Stopped after many steps. Say “continue” to keep going.' });
    }
  } catch (e) {
    const aborted = abort.signal.aborted || (e as Error)?.name === 'AbortError';
    push({ kind: 'error', id: nid(), text: aborted ? 'Stopped.' : explainError(e) });
    // Close any dangling function calls so the next turn is valid.
    const last = history[history.length - 1];
    if (last?.role === 'model' && last.parts.some((p) => p.functionCall)) {
      history = [...history, { role: 'user', parts: last.parts.filter((p) => p.functionCall).map((p) => ({ functionResponse: { name: p.functionCall!.name, response: { error: aborted ? 'Stopped by user' : 'Failed' }, ...(p.functionCall!.id ? { id: p.functionCall!.id } : {}) } })) }];
    }
  } finally {
    useAgent.setState((s) => ({
      running: false,
      abort: null,
      status: '',
      history,
      items: s.items.map((it) => (it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'error', summary: it.summary || 'Interrupted' } : it.kind === 'assistant' && it.streaming ? { ...it, streaming: false } : it)),
    }));
    if (mode === 'agent') {
      useDaw.getState().endTransaction();
      const after = getProject();
      const diff = diffProjects(checkpoint, after);
      if (diff.lines.length) push({ kind: 'changes', id: nid(), lines: diff.lines, checkpoint, state: 'pending' });
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
  useDaw.getState().replaceProject(checkpoint, { keepHistory: true, label: 'Revert agent changes' });
  if (itemId) patch(itemId, (it) => (it.kind === 'changes' ? { ...it, state: 'reverted' } : it));
}

export function keepAllPending() {
  const items = useAgent.getState().items.filter((i) => i.kind === 'changes' && i.state === 'pending');
  for (const i of items) keepChanges(i.id);
}
