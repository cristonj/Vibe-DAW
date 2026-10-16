import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp, Square, Ear, Sparkles, Drum, Piano, Plus, SlidersHorizontal, Search, AudioLines, Gauge, Layers, Scissors, Play, Check,
  RotateCcw, Paperclip, X, Brain, ListChecks, Trash, Pencil, Music, Repeat, CircleStop, Eye,
} from 'lucide-react';
import { useAgent, runAgent, stopAgent, keepChanges, revertTo, type ChatItem } from '../../agent/agent';
import { analyzeReference } from '../../agent/ears';
import { useSettings, MODELS, aiAvailable } from '../../state/settings';
import { useDaw } from '../../state/store';
import { previewSample } from '../../engine/api';
import { Markdown } from '../Markdown';
import { toast } from '../toast';

const TOOL_ICONS: Record<string, typeof Ear> = {
  listen: Ear, audition_samples: Ear, write_drums: Drum, write_notes: Piano, create_track: Plus,
  update_track: Pencil, delete_track: Trash, add_effect: SlidersHorizontal, update_effect: SlidersHorizontal, remove_effect: SlidersHorizontal,
  search_samples: Search, design_sound: AudioLines, set_project: Gauge, copy_bars: Layers, clear_bars: Scissors, play: Play, stop: CircleStop,
  set_drum_lane: Drum, add_audio_clip: AudioLines, edit_clip: Pencil, delete_clips: Trash, transform_notes: Music, set_sections: ListChecks,
  bounce_to_sample: AudioLines, set_loop: Repeat, get_project_state: Eye, get_notes: Eye,
};

const SUGGESTIONS = [
  'Make a Lil Peep type beat',
  'Listen to my mix and tell me what to fix',
  'Turn this loop into a full 2-minute arrangement',
  'Make the drums hit harder and add hat rolls',
];

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
          {item.sampleIds?.slice(0, 1).map((id) => (
            <button key={id} className="btn icon" style={{ width: 22, height: 22 }} title="Preview sound" onClick={() => void previewSample(id)}><Play size={11} fill="currentColor" /></button>
          ))}
          {item.clipIds?.length ? (
            <button className="btn icon" style={{ width: 22, height: 22 }} title="Open in editor" onClick={() => { select({ clipIds: item.clipIds! }); openEditor(item.clipIds![0]); }}><Eye size={12} /></button>
          ) : null}
        </div>
      </div>
      {item.heard && (
        <div className="heard">
          <div className="heard-label"><Ear size={12} /> {item.name === 'listen' ? 'What I heard' : 'Auditioned'}</div>
          <Markdown text={item.heard} />
        </div>
      )}
    </>
  );
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg-user">
          <button className="btn icon restore" title="Restore the project to before this message" onClick={() => revertTo(item.checkpoint)}><RotateCcw size={13} /></button>
          {item.focus && <span className="focus">On {item.focus}</span>}
          {item.text}
        </div>
      );
    case 'assistant':
      return (
        <div className="msg-ai">
          {item.thinking && (
            <details className="thinking">
              <summary><Brain size={12} /> {item.streaming && !item.text ? 'Thinking…' : 'Thought process'}</summary>
              <div className="body">{item.thinking}</div>
            </details>
          )}
          {item.text && <div className={item.streaming ? 'cursor-blink' : ''}><Markdown text={item.text} /></div>}
        </div>
      );
    case 'tool':
      return <ToolRow item={item} />;
    case 'plan':
      return (
        <div className="plan">
          <div className="plan-title">Plan</div>
          {item.steps.map((s, i) => (
            <div key={i} className={`plan-step ${s.status}`}>
              <span className="box">{s.status === 'done' ? <Check size={10} strokeWidth={3} /> : null}</span>
              {s.title}
            </div>
          ))}
        </div>
      );
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

export function AgentPanel({ open, focusSignal }: { open: boolean; focusSignal: number }) {
  const items = useAgent((s) => s.items);
  const running = useAgent((s) => s.running);
  const status = useAgent((s) => s.status);
  const mode = useAgent((s) => s.mode);
  const tokens = useAgent((s) => s.tokens);
  const model = useSettings((s) => s.model);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Array<{ name: string; text: string }>>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);

  useEffect(() => { if (focusSignal) taRef.current?.focus(); }, [focusSignal]);

  useEffect(() => {
    const el = feedRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  const send = (t = text) => {
    if (!t.trim() || running) return;
    const att = attachments.map((a) => `<reference_track name="${a.name}">\n${a.text}\n</reference_track>`);
    void runAgent(t, { attachments: att });
    setText('');
    setAttachments([]);
    stick.current = true;
  };

  const attach = async (file: File) => {
    const avail = aiAvailable();
    if (!avail.ok) { toast(avail.reason!, 'error'); return; }
    setAnalyzing(true);
    try {
      const breakdown = await analyzeReference(await file.arrayBuffer(), file.name);
      setAttachments((a) => [...a, { name: file.name, text: breakdown }]);
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
          <button className={mode === 'agent' ? 'on' : ''} onClick={() => useAgent.getState().setMode('agent')} role="radio" aria-checked={mode === 'agent'} title="The agent edits your project">Agent</button>
          <button className={mode === 'ask' ? 'on' : ''} onClick={() => useAgent.getState().setMode('ask')} role="radio" aria-checked={mode === 'ask'} title="Read-only: questions and feedback">Ask</button>
        </div>
        <button className="btn icon" title="New chat" disabled={running} onClick={() => useAgent.getState().clear()}><Plus size={15} /></button>
      </div>

      <div className="feed" ref={feedRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {items.length === 0 ? (
          <div className="agent-empty">
            <h3>Your co-producer</h3>
            <p>It edits the session like you would, listens to every sound it picks, and checks the mix by ear. Everything it does is one undo away.</p>
            {SUGGESTIONS.map((s) => <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>)}
          </div>
        ) : items.map((it) => <Item key={it.id} item={it} />)}
      </div>

      <div className="composer">
        {running && <div className="status"><span className="agent-dot busy" /> {status}</div>}
        <div className="composer-box">
          {(attachments.length > 0 || analyzing) && (
            <div className="composer-row" style={{ flexWrap: 'wrap' }}>
              {attachments.map((a, i) => (
                <span className="attach-chip" key={i} title={a.text}>
                  <Ear size={11} /> {a.name}
                  <button onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))} aria-label={`Remove ${a.name}`}><X size={11} /></button>
                </span>
              ))}
              {analyzing && <span className="attach-chip"><Ear size={11} /> Listening to reference…</span>}
            </div>
          )}
          <textarea
            ref={taRef}
            value={text}
            rows={2}
            placeholder={mode === 'agent' ? 'Describe what to make or change…' : 'Ask about your track…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            aria-label="Message the agent"
          />
          <div className="composer-row">
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
            {running ? (
              <button className="send stop" onClick={stopAgent} title="Stop" aria-label="Stop"><Square size={13} fill="currentColor" /></button>
            ) : (
              <button className="send" onClick={() => send()} disabled={!text.trim()} title="Send (Enter)" aria-label="Send"><ArrowUp size={16} /></button>
            )}
          </div>
        </div>
        <div className="agent-foot">
          <span>Ctrl+K edits a selected clip</span>
          {tokens.input + tokens.output > 0 && <span>{Math.round((tokens.input + tokens.output) / 1000)}k tokens</span>}
        </div>
      </div>
    </aside>
  );
}
