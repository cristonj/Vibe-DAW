import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp, Square, Ear, Sparkles, Drum, Piano, Plus, SlidersHorizontal, Search, AudioLines, Gauge, Layers, Scissors, Play, Check,
  RotateCcw, Paperclip, X, Brain, ListChecks, Trash, Pencil, Music, Repeat, CircleStop, Eye, Mic, LoaderCircle, Pause,
} from 'lucide-react';
import { useAgent, runAgent, stopAgent, keepChanges, revertTo, type ChatItem } from '../../agent/agent';
import { analyzeReference } from '../../agent/ears';
import { useSettings, MODELS, aiAvailable } from '../../state/settings';
import { useDaw } from '../../state/store';
import { Markdown } from '../Markdown';
import { shuffledSuggestions } from '../../agent/suggestions';
import { Shuffle } from 'lucide-react';
import { useLibrary } from '../../samples/library';
import { usePresets } from '../../state/presetLibrary';
import { attachChatReference, chatReferenceCatalog, resolveChatReferences, serializeChatReference, useChatReferences, type ChatReference } from '../chatReferences';
import { AtSign, MessageSquarePlus } from 'lucide-react';
import { toast } from '../toast';
import { MAX_VOICE_SECONDS, useVoiceRecorder, voiceSupported, type VoiceClip } from '../voice';

const TOOL_ICONS: Record<string, typeof Ear> = {
  listen: Ear, audition_samples: Ear, write_drums: Drum, write_notes: Piano, create_track: Plus,
  update_track: Pencil, delete_track: Trash, add_effect: SlidersHorizontal, update_effect: SlidersHorizontal, remove_effect: SlidersHorizontal,
  search_samples: Search, design_sound: AudioLines, set_project: Gauge, copy_bars: Layers, clear_bars: Scissors, play: Play, stop: CircleStop,
  set_drum_lane: Drum, add_audio_clip: AudioLines, edit_clip: Pencil, delete_clips: Trash, transform_notes: Music, set_sections: ListChecks,
  bounce_to_sample: AudioLines, set_loop: Repeat, get_project_state: Eye, get_notes: Eye,
};

function Plan({ item, pinned = false }: { item: Extract<ChatItem, { kind: 'plan' }>; pinned?: boolean }) {
  const done = item.steps.filter((s) => s.status === 'done').length;
  return <details data-chat-ref={`chat:${item.id}`} className={`plan ${pinned ? 'pinned-plan' : ''}`} open>
    <summary className="plan-title"><ListChecks size={14} /><b>Checklist</b><span>{done}/{item.steps.length}</span></summary>
    <div className="plan-steps">{item.steps.map((s, i) => (
      <div key={i} className={`plan-step ${s.status}`}>
        <span className="box">{s.status === 'done' ? <Check size={10} strokeWidth={3} /> : null}</span>
        {s.title}
      </div>
    ))}</div>
    <button className="btn" onClick={() => attachChatReference(`chat:${item.id}`)}><MessageSquarePlus size={12} /> Add checklist to chat</button>
  </details>;
}

function ToolRow({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const Icon = TOOL_ICONS[item.name] ?? Sparkles;
  const { select, openEditor } = useDaw.getState();
  return (
    <>
      <div className={`tool-row ${item.status}`}>
        <span className="ico"><Icon size={12} /></span>
        <div className="txt">
          {item.summary || <span style={{ color: 'var(--faint)' }}>{item.name.replace(/_/g, ' ')}…</span>}
        </div>
        <div className="actions">
          {item.clipIds?.length ? (
            <button className="btn icon" style={{ width: 22, height: 22 }} title="Open in editor" onClick={() => { select({ clipIds: item.clipIds! }); openEditor(item.clipIds![0]); }}><Eye size={12} /></button>
          ) : null}
        </div>
      </div>
      {item.heard && (
        <section data-chat-ref={`review:${item.id}`} className="listening-review" aria-label={item.name === 'listen' ? 'Mix review' : 'Sound review'}>
          <header><Ear size={15} /><b>{item.name === 'listen' ? 'Mix review' : 'Sound review'}</b><span>Producer notes</span><button className="btn icon" onClick={() => attachChatReference(`review:${item.id}`)} aria-label="Add Producer notes to chat" title="Add these Producer notes to chat"><MessageSquarePlus size={13} /></button></header>
          <div className="review-notes" tabIndex={0} aria-label="Producer review notes"><Markdown text={item.heard} /></div>
        </section>
      )}
    </>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A sent voice message: tap to hear it again. */
function VoiceNote({ url, seconds }: { url: string; seconds: number }) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = () => {
    audio.current ??= Object.assign(new Audio(url), { onended: () => setPlaying(false) });
    if (playing) { audio.current.pause(); setPlaying(false); }
    else { audio.current.currentTime = 0; void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
  };
  return (
    <button className="voice-note" onClick={toggle} aria-label={playing ? 'Stop voice message' : 'Play voice message'}>
      {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
      <Mic size={12} /> Voice message · {clock(seconds)}
    </button>
  );
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg-user">
          <button className="btn icon restore" title="Restore the project to before this message" onClick={() => revertTo(item.checkpoint)}><RotateCcw size={13} /></button>
          {item.focus && <span className="focus">On {item.focus}</span>}
          {item.steering && <span className="focus">{item.steering === 'queued' ? 'Steering queued' : item.steering === 'applied' ? 'Steering applied' : 'Steering not applied (run stopped)'}</span>}
          {item.voice && <VoiceNote url={item.voice.url} seconds={item.voice.seconds} />}
          {item.text}
        </div>
      );
    case 'assistant':
      return (
        <div className="msg-ai" data-chat-ref={`chat:${item.id}`}>
          {item.thinking && (
            <details className="thinking">
              <summary><Brain size={12} /> {item.streaming && !item.text ? 'Thinking…' : 'Thought process'}</summary>
              <div className="body">{item.thinking}</div>
            </details>
          )}
          {item.text && <div className={item.streaming ? 'cursor-blink' : ''}><Markdown text={item.text} /></div>}
          {!item.streaming && item.text && <button className="btn msg-add" onClick={() => attachChatReference(`chat:${item.id}`)} aria-label="Add message to chat"><MessageSquarePlus size={12} /> Add to chat</button>}
        </div>
      );
    case 'tool':
      return <ToolRow item={item} />;
    case 'plan':
      return <Plan item={item} />;
    case 'changes':
      return (
        <div className={`changes ${item.state}`}>
          <div className="changes-head">
            <Sparkles size={13} color="var(--agent)" />
            {item.state === 'pending' ? 'Changes to review' : item.state === 'kept' ? 'Changes kept' : 'Changes undone'}
          </div>
          <ul>{item.lines.slice(0, 14).map((l, i) => <li key={i}>{l}</li>)}{item.lines.length > 14 && <li>…and {item.lines.length - 14} more</li>}</ul>
          {item.state === 'pending' && (
            <div className="actions">
              <button className="btn primary" onClick={() => keepChanges(item.id)}><Check size={14} /> Keep</button>
              <button className="btn solid" onClick={() => revertTo(item.checkpoint, item.id)}><RotateCcw size={14} /> Undo all</button>
            </div>
          )}
        </div>
      );
    case 'error':
      return <div className="err">{item.text}</div>;
  }
}

export function AgentPanel({ open, focusSignal, onClose }: { open: boolean; focusSignal: number; onClose: () => void }) {
  const items = useAgent((s) => s.items);
  const running = useAgent((s) => s.running);
  const status = useAgent((s) => s.status);
  const mode = useAgent((s) => s.mode);
  const tokens = useAgent((s) => s.tokens);
  const context = useAgent((s) => s.context);
  const model = useSettings((s) => s.model);
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState(() => shuffledSuggestions('song'));
  useEffect(() => { setSuggestions(shuffledSuggestions(mode === 'ask' ? 'ask' : 'song')); }, [mode]);
  const project = useDaw((s) => s.project);
  const selection = useDaw((s) => s.selection);
  const samples = useLibrary((s) => s.samples), presets = usePresets((s) => s.records);
  const pending = useChatReferences((s) => s.pending);
  const extras = useChatReferences((s) => s.extras);
  const [caret, setCaret] = useState(0), [mentionIndex, setMentionIndex] = useState(0);
  const [recentReferences, setRecentReferences] = useState<ChatReference[]>([]);
  const mention = text.slice(0, caret).match(/(?:^|\s)@([^\n@]*)$/);
  const mentionQuery = mention?.[1].toLowerCase();
  const catalog = useMemo(() => mention ? chatReferenceCatalog() : [], [mentionQuery, project, selection, samples, presets, items, recentReferences, extras]);
  const choices = catalog.filter((r) => `${r.label} ${r.kind} ${r.id}`.toLowerCase().includes(mentionQuery ?? '')).slice(0, 12);
  const [attachments, setAttachments] = useState<Array<{ name: string; text: string }>>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  // Voice messages go to the model as audio; anything typed in the box rides along.
  const textRef = useRef(text);
  textRef.current = text;
  const recorder = useVoiceRecorder(
    (clip) => dispatch(textRef.current, clip),
    (message) => toast(message, 'error'),
  );
  const recording = recorder.state === 'recording';
  const latestPlan = items.findLast((it): it is Extract<ChatItem, { kind: 'plan' }> => it.kind === 'plan');

  useEffect(() => { setMentionIndex(0); }, [mentionQuery]);
  useEffect(() => {
    const extras: ChatReference[] = items.flatMap((item) => {
      if (item.kind === 'tool' && item.heard) return [{ id: `review:${item.id}`, label: item.summary || 'Producer notes', kind: 'Producer review', text: item.heard }];
      if (item.kind === 'plan') return [{ id: `chat:${item.id}`, label: 'Producer checklist', kind: 'Checklist', text: item.steps.map((s) => `${s.status}: ${s.title}`).join('\n') }];
      if (item.kind === 'assistant' && item.text) return [{ id: `chat:${item.id}`, label: item.text.slice(0, 80), kind: 'Chat message', text: item.text }];
      return [];
    });
    useChatReferences.setState({ extras: [...extras, ...recentReferences] });
  }, [items, recentReferences]);
  useEffect(() => { useChatReferences.setState({ pending: [] }); setAttachments([]); setRecentReferences([]); }, [project.id]);

  useEffect(() => { if (focusSignal) taRef.current?.focus(); }, [focusSignal]);

  useEffect(() => {
    const el = feedRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  const dispatch = (t: string, voice?: VoiceClip) => {
    const avail = aiAvailable();
    if (!avail.ok) { toast(avail.reason!, 'error'); window.dispatchEvent(new Event('vibe:open-settings')); return; }
    const references = resolveChatReferences();
    const att = [...attachments.map((a) => `<reference_track>\n${JSON.stringify(a)}\n</reference_track>`), ...references.map(serializeChatReference)];
    const focusSelection = references.findLast((r) => r.selection)?.selection;
    void runAgent(t || 'Please review the attached references.', { attachments: att, focusSelection, voice });
    useChatReferences.setState({ pending: [] });
    setText('');
    setAttachments([]);
    stick.current = true;
  };

  const send = async (t = text) => {
    if (analyzing || recorder.state === 'encoding') return;
    if (recording) {
      const clip = await recorder.stop();
      if (clip) dispatch(textRef.current, clip);
      return;
    }
    if (!t.trim() && !pending.length && !attachments.length) return;
    dispatch(t);
  };

  const pickMention = (id: string) => {
    if (!mention) return;
    attachChatReference(id);
    const at = caret - mention[1].length - 1;
    const next = text.slice(0, at) + text.slice(caret);
    setText(next); setCaret(at);
    requestAnimationFrame(() => { taRef.current?.focus(); taRef.current?.setSelectionRange(at, at); });
  };

  const startVoice = () => {
    const avail = aiAvailable();
    if (!avail.ok) { toast(avail.reason!, 'error'); window.dispatchEvent(new Event('vibe:open-settings')); return; }
    void recorder.start();
  };

  const attach = async (file: File) => {
    const avail = aiAvailable();
    if (!avail.ok) { toast(avail.reason!, 'error'); return; }
    setAnalyzing(true);
    try {
      const breakdown = await analyzeReference(await file.arrayBuffer(), file.name);
      setAttachments((a) => [...a, { name: file.name, text: breakdown }]);
      setRecentReferences((refs) => [...refs, { id: `reference:${Date.now()}`, label: file.name, kind: 'Reference track', text: breakdown }]);
      toast(`Listened to ${file.name}`);
    } catch (e) {
      toast(`Couldn't analyze ${file.name}: ${(e as Error).message}`, 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <aside className={`agent ${open ? '' : 'collapsed'}`} aria-label="Agent">
      <div className="agent-head">
        <div className="agent-title"><span className={`agent-dot ${running ? 'busy' : ''}`} /> Producer</div>
        <div className="seg" role="radiogroup" aria-label="Agent mode">
          <button className={mode === 'agent' ? 'on' : ''} disabled={running} onClick={() => useAgent.getState().setMode('agent')} role="radio" aria-checked={mode === 'agent'} title="The agent edits your project">Agent</button>
          <button className={mode === 'ask' ? 'on' : ''} disabled={running} onClick={() => useAgent.getState().setMode('ask')} role="radio" aria-checked={mode === 'ask'} title="Read-only: questions and feedback">Ask</button>
        </div>
        <button className="btn icon" title="New chat" disabled={running} onClick={() => { useAgent.getState().clear(); useChatReferences.setState({ pending: [] }); setText(''); setAttachments([]); setRecentReferences([]); }}><Plus size={15} /></button>
        <button className="btn icon drawer-close" onClick={onClose} aria-label="Close Producer panel"><X size={16} /></button>
      </div>

      {latestPlan && <Plan key={latestPlan.id} item={latestPlan} pinned />}

      <div className="feed" ref={feedRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {items.length === 0 ? (
          <div className="agent-empty">
            <h3>Your co-producer</h3>
            <p>It edits the session like you would, listens to every sound it picks, and checks the mix by ear. Everything it does is one undo away.</p>
            {suggestions.map((s) => <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>)}
            <button className="btn" onClick={() => setSuggestions(shuffledSuggestions(mode === 'ask' ? 'ask' : 'song'))}><Shuffle size={13} /> More ideas</button>
          </div>
        ) : items.filter((it) => it.id !== latestPlan?.id).map((it) => <Item key={it.id} item={it} />)}
      </div>

      <div className="composer">
        {running && <div className="status"><span className="agent-dot busy" /> {status}</div>}
        <div className="composer-box">
          {recorder.state !== 'idle' && (
            <div className="rec-row" role="status">
              {recording ? <span className="rec-dot" /> : <LoaderCircle size={13} className="spin" />}
              <span>{recording ? `Recording ${clock(recorder.seconds)}` : 'Preparing…'}</span>
              {recording && recorder.seconds > MAX_VOICE_SECONDS - 15 && <span className="rec-limit">sends at {clock(MAX_VOICE_SECONDS)}</span>}
              <div className="spacer" />
              {recording && <button className="btn" onClick={recorder.cancel} aria-label="Discard voice message"><X size={13} /> Discard</button>}
            </div>
          )}
          {(attachments.length > 0 || pending.length > 0 || analyzing) && (
            <div className="composer-row" style={{ flexWrap: 'wrap' }}>
              {pending.map((r) => <span className="attach-chip" key={r.id}><AtSign size={11} /><span>{r.label}</span><button onClick={() => useChatReferences.setState((s) => ({ pending: s.pending.filter((p) => p.id !== r.id) }))} aria-label={`Remove ${r.label}`}><X size={11} /></button></span>)}
              {attachments.map((a, i) => (
                <span className="attach-chip" key={i} title={a.text}>
                  <Ear size={11} /> {a.name}
                  <button onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${a.name}`}><X size={11} /></button>
                </span>
              ))}
              {analyzing && <span className="attach-chip"><Ear size={11} /> Listening to reference…</span>}
            </div>
          )}
          {mention && <div className="mention-picker" role="listbox" aria-label="Add a project reference">
            <div className="mention-heading">Add to chat · ↑↓ choose · Enter to attach</div>
            {choices.map((r, i) => <button type="button" role="option" aria-selected={i === mentionIndex} className={i === mentionIndex ? 'active' : ''} key={r.id} onPointerDown={(e) => e.preventDefault()} onClick={() => pickMention(r.id)}><b>{r.label}</b><small>{r.kind} · {r.id}</small></button>)}
            {!choices.length && <p>No matching references. Try a track, clip, effect, section, sound, saved item, note or review.</p>}
          </div>}
          <textarea
            ref={taRef}
            value={text}
            rows={2}
            placeholder={recording ? 'Talk now. Tap send when you’re done (you can add a typed note too).' : running ? 'Steer the agent while it works…' : mode === 'agent' ? 'Describe what to make or change…' : 'Ask about your track…'}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (mention && !e.nativeEvent.isComposing) {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCaret(0); return; }
                if (choices.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key) && !e.shiftKey) {
                  e.preventDefault(); e.stopPropagation();
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setMentionIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length);
                  else pickMention(choices[Math.min(mentionIndex, choices.length - 1)].id);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            aria-label="Message the agent"
          />
          <div className="composer-row">
            <button className="btn icon" aria-label="Mention a project item" title="Attach tracks, clips, effects, sounds, notes and Producer reviews (@)" onClick={() => { const next = text + (text && !/\s$/.test(text) ? ' ' : '') + '@'; setText(next); setCaret(next.length); requestAnimationFrame(() => { taRef.current?.focus(); taRef.current?.setSelectionRange(next.length, next.length); }); }}><AtSign size={15} /></button>
            <button className="btn icon" title="Attach a reference track — the agent listens and matches its style" onClick={() => fileRef.current?.click()} disabled={analyzing}><Paperclip size={15} /></button>
            <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = ''; }} />
            <select
              value={model}
              onChange={(e) => useSettings.getState().set({ model: e.target.value as typeof model })}
              aria-label="Model"
              style={{ border: 0, background: 'transparent', color: 'var(--faint)', fontSize: 12, padding: '2px 4px' }}
            >
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <div className="spacer" />
            {voiceSupported() && !recording && (
              <button
                className="btn icon mic"
                onClick={startVoice}
                disabled={recorder.state !== 'idle'}
                aria-label="Record a voice message"
                title="Talk to the Producer: it hears your voice directly"
              >
                <Mic size={15} />
              </button>
            )}
            {running && (
              <button className="send stop" onClick={stopAgent} title="Stop" aria-label="Stop"><Square size={13} fill="currentColor" /></button>
            )}
            <button className={`send ${recording ? 'recording' : ''}`} onClick={() => void send()} disabled={(!text.trim() && !recording && !pending.length && !attachments.length) || analyzing || recorder.state === 'encoding'} title={recording ? 'Send voice message (Enter)' : running ? 'Send steering (Enter)' : 'Send (Enter)'} aria-label={recording ? 'Send voice message' : running ? 'Send steering' : 'Send'}><ArrowUp size={16} /></button>
          </div>
        </div>
        <div className="agent-foot">
          <span className="hide-touch">Type @ to attach · Shift-drag + Ctrl+K to edit</span>
          {context.compactions > 0 && <span title="Older exchanges are summarized automatically. The agent can also manage its own working memory.">Memory compacted {context.compactions}×</span>}
          {tokens.input + tokens.output > 0 && <span>{Math.round((tokens.input + tokens.output) / 1000)}k tokens</span>}
        </div>
      </div>
    </aside>
  );
}
