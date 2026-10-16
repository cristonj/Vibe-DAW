import { useState } from 'react';
import { Play, Sparkles } from 'lucide-react';
import { useDaw } from '../../state/store';
import type { MidiClip, Project, Track } from '../../model/types';
import { beatsPerBar, uid } from '../../model/project';
import { previewNote } from '../../engine/api';
import { openInlineAI } from './InlineAI';

const RES: Array<[string, number]> = [['1/16', 4], ['1/32', 8], ['1/8T', 3], ['1/16T', 6], ['1/8', 2]];

export function DrumEditor({ clip, track, project }: { clip: MidiClip; track: Track; project: Project }) {
  const update = useDaw((s) => s.update);
  const [perBeat, setPerBeat] = useState(4);
  const bpb = beatsPerBar(project);
  const stepLen = 1 / perBeat;
  const steps = Math.round(clip.length * perBeat);
  const lanes = track.drumLanes ?? [];

  const edit = (label: string, fn: (c: MidiClip) => void) => update(label, (d) => {
    for (const t of d.tracks) for (const c of t.clips) if (c.id === clip.id && c.type === 'midi') { fn(c); delete c.aiPending; }
  });

  const hitsIn = (note: number, i: number) => clip.notes.filter((n) => n.pitch === note && n.start >= i * stepLen - 1e-6 && n.start < (i + 1) * stepLen - 1e-6);

  const toggle = (note: number, i: number, e: React.MouseEvent) => {
    const existing = hitsIn(note, i);
    if (existing.length) {
      const ids = new Set(existing.map((n) => n.id));
      edit('Remove hit', (c) => { c.notes = c.notes.filter((n) => !ids.has(n.id)); });
      return;
    }
    const velocity = e.shiftKey ? 1 : e.altKey ? 0.45 : 0.85;
    edit('Add hit', (c) => { c.notes.push({ id: uid(), pitch: note, start: i * stepLen, duration: 0.25, velocity }); });
    previewNote(track.id, note, velocity);
  };

  return (
    <div className="roll">
      <div className="roll-tools">
        <input type="text" value={clip.name} aria-label="Clip name" onChange={(e) => edit('Rename clip', (c) => { c.name = e.target.value; })} />
        <label className="group">Bars
          <input type="number" min={0.25} step={0.25} value={Math.round((clip.length / bpb) * 100) / 100} aria-label="Clip length in bars" onChange={(e) => { const v = Number(e.target.value); if (v > 0) edit('Clip length', (c) => { c.length = v * bpb; }); }} />
        </label>
        <label className="group">Steps
          <select value={perBeat} onChange={(e) => setPerBeat(Number(e.target.value))} aria-label="Step resolution">
            {RES.map(([l, v]) => <option key={l} value={v}>{l}</option>)}
          </select>
        </label>
        <span style={{ color: 'var(--faint)', fontSize: 12, marginLeft: 8 }}>Click to toggle · Shift = accent · Alt = ghost</span>
        <div style={{ flex: 1 }} />
        <button className="btn" style={{ color: 'var(--agent)' }} onClick={() => openInlineAI([clip.id])}><Sparkles size={14} /> Edit with AI</button>
      </div>
      <div className="drum-grid">
        {lanes.map((l) => (
          <div className="drum-row" key={l.id}>
            <div className="lname">
              <button className="btn icon" style={{ width: 22, height: 22 }} onClick={() => previewNote(track.id, l.note, 0.9)} aria-label={`Preview ${l.name}`}><Play size={11} fill="currentColor" /></button>
              {l.name}
            </div>
            <div className="steps">
              {Array.from({ length: steps }, (_, i) => {
                const hits = hitsIn(l.note, i);
                const on = hits.length > 0;
                const vel = on ? Math.max(...hits.map((h) => h.velocity)) : 0;
                const isBeat = i % perBeat === 0;
                const barStart = i > 0 && i % (perBeat * bpb) === 0;
                return (
                  <button
                    key={i}
                    className={`step ${on ? 'on' : ''} ${isBeat ? 'beat' : ''} ${barStart ? 'bar-start' : ''}`}
                    style={{ ['--c' as string]: track.color, opacity: on ? 0.45 + vel * 0.55 : 1, width: perBeat > 4 ? 14 : 22 }}
                    onClick={(e) => toggle(l.note, i, e)}
                    aria-label={`${l.name} step ${i + 1}${on ? ' on' : ''}`}
                  >
                    {hits.length > 1 ? <span style={{ fontSize: 9, fontWeight: 700, color: '#10131c' }}>{hits.length}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!lanes.length && <div className="dock-empty">This kit has no lanes yet.</div>}
      </div>
    </div>
  );
}
