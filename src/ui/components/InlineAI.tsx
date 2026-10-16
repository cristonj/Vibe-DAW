import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Sparkles } from 'lucide-react';
import { useDaw } from '../../state/store';
import { findClip } from '../../model/project';
import { runAgent, useAgent } from '../../agent/agent';

// Ctrl+K: Cursor-style inline edit, scoped to the selected clips.

const useInline = create<{ clipIds: string[] | null }>(() => ({ clipIds: null }));

export function openInlineAI(clipIds?: string[]) {
  const ids = clipIds ?? useDaw.getState().selection.clipIds;
  useInline.setState({ clipIds: ids });
}

const QUICK: Record<'midi' | 'drums' | 'audio', string[]> = {
  midi: ['Make it sadder', 'Add a counter-melody variation', 'Simplify the rhythm', 'Make it bounce more'],
  drums: ['Add hi-hat rolls', 'Make it hit harder', 'Halftime feel', 'Add a fill at the end'],
  audio: ['Chop it into a new pattern', 'Make it sound older / lo-fi', 'Reverse swell into the next bar', 'Fit it in the mix'],
};

export function InlineAI() {
  const clipIds = useInline((s) => s.clipIds);
  const running = useAgent((s) => s.running);
  const project = useDaw((s) => s.project);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (clipIds) { setText(''); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [clipIds]);

  if (!clipIds) return null;
  const found = clipIds.map((id) => findClip(project, id)).filter((x): x is NonNullable<typeof x> => !!x);
  const kind = found[0] ? (found[0].clip.type === 'audio' ? 'audio' : found[0].track.kind === 'drums' ? 'drums' : 'midi') : 'midi';
  const close = () => useInline.setState({ clipIds: null });
  const submit = (t: string) => {
    if (!t.trim()) return;
    close();
    void runAgent(t, { focusClipIds: found.map((f) => f.clip.id), mode: 'agent' });
  };

  return (
    <div className="overlay" style={{ background: 'rgba(8,9,16,0.35)', placeItems: 'start center' }} onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="inline-ai" role="dialog" aria-label="Edit with AI">
        <div className="ctx">
          <Sparkles size={13} />
          {found.length ? `Editing ${found.map((f) => `“${f.clip.name}” (${f.track.name})`).join(', ')}` : 'No clip selected — this will go to the agent for the whole song'}
        </div>
        <input
          ref={inputRef}
          value={text}
          placeholder={found.length ? 'What should change?' : 'Ask the agent…'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(text); if (e.key === 'Escape') close(); }}
          aria-label="Instruction"
        />
        <div className="suggestions" style={{ marginTop: 8 }}>
          {QUICK[kind].map((q) => <button key={q} className="suggestion" onClick={() => submit(q)}>{q}</button>)}
        </div>
        <div className="hint">{running ? 'Enter to steer the active run' : 'Enter to run'} · Esc to close · changes show up in lilac until you keep them</div>
      </div>
    </div>
  );
}
