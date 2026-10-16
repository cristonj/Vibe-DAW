import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Sparkles } from 'lucide-react';
import { useDaw } from '../../state/store';
import type { MidiClip, Note, Project, Track } from '../../model/types';
import { beatsPerBar, uid } from '../../model/project';
import { isInKey, midiToNote } from '../../model/theory';
import { transformNotes } from '../../model/edit';
import { previewNote } from '../../engine/engine';
import { openInlineAI } from './InlineAI';

const ROW = 14;
const LOW = 21; // A0
const HIGH = 108; // C8
const ROWS = HIGH - LOW + 1;
const BLACK = new Set([1, 3, 6, 8, 10]);

export function PianoRoll({ clip, track, project }: { clip: MidiClip; track: Track; project: Project }) {
  const update = useDaw((s) => s.update);
  const [ppb, setPpb] = useState(72);
  const [grid, setGrid] = useState(0.25);
  const [selected, setSelected] = useState<string[]>([]);
  const [lastLen, setLastLen] = useState(0.5);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bpb = beatsPerBar(project);
  const width = Math.max(clip.length + bpb, 8) * ppb;

  // Center the view on the clip's notes when a different clip opens.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const pitches = clip.notes.map((n) => n.pitch);
    const mid = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : track.kind === 'instrument' && track.instrument?.preset === 'bass808' ? 30 : 60;
    el.scrollTop = (HIGH - mid) * ROW - el.clientHeight / 2;
    setSelected([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  const editNotes = (label: string, fn: (notes: Note[], c: MidiClip) => void, coalesce = true) => {
    update(label, (d) => {
      for (const t of d.tracks) for (const c of t.clips) if (c.id === clip.id && c.type === 'midi') { fn(c.notes, c); delete c.aiPending; }
    }, { coalesce });
  };

  const snap = (b: number) => (grid > 0 ? Math.round(b / grid) * grid : b);
  const floorSnap = (b: number) => (grid > 0 ? Math.floor(b / grid) * grid : b);

  const posFrom = (e: { clientX: number; clientY: number }) => {
    const rect = (bodyRef.current!.querySelector('.grid') as HTMLElement).getBoundingClientRect();
    const beat = (e.clientX - rect.left) / ppb;
    const pitch = HIGH - Math.floor((e.clientY - rect.top) / ROW);
    return { beat, pitch: Math.max(LOW, Math.min(HIGH, pitch)) };
  };

  const onGridDown = (e: RPointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const { beat, pitch } = posFrom(e);
    const start = Math.max(0, floorSnap(beat));
    if (start >= clip.length) return;
    const id = uid();
    const note: Note = { id, pitch, start, duration: Math.min(lastLen, clip.length - start), velocity: 0.8 };
    editNotes('Add note', (ns) => { ns.push(note); }, false);
    setSelected([id]);
    previewNote(track.id, pitch, 0.8);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const b = posFrom(ev).beat;
      const len = Math.max(grid > 0 ? grid : 0.05, snap(b) - start);
      editNotes('Add note', (ns) => { const n = ns.find((x) => x.id === id); if (n) n.duration = len; });
      setLastLen(len);
    };
    const onUp = () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  const onNoteDown = (e: RPointerEvent, n: Note, mode: 'move' | 'resize') => {
    e.stopPropagation();
    if (e.button === 2) return;
    const sel = e.shiftKey ? (selected.includes(n.id) ? selected : [...selected, n.id]) : selected.includes(n.id) ? selected : [n.id];
    setSelected(sel);
    if (mode === 'move') previewNote(track.id, n.pitch, n.velocity);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const p0 = posFrom(e);
    const orig = new Map(clip.notes.filter((x) => sel.includes(x.id)).map((x) => [x.id, { ...x }]));
    let lastPitchDelta = 0;
    const onMove = (ev: PointerEvent) => {
      const p = posFrom(ev);
      const db = p.beat - p0.beat;
      if (mode === 'resize') {
        editNotes('Resize note', (ns) => {
          for (const x of ns) {
            const o = orig.get(x.id);
            if (o) x.duration = Math.max(grid > 0 ? grid / 2 : 0.05, snap(o.start + o.duration + db) - o.start);
          }
        });
        return;
      }
      const dp = p.pitch - p0.pitch;
      const dbSnapped = grid > 0 ? Math.round(db / grid) * grid : db;
      editNotes('Move notes', (ns) => {
        for (const x of ns) {
          const o = orig.get(x.id);
          if (!o) continue;
          x.start = Math.max(0, Math.min(clip.length - 0.01, o.start + dbSnapped));
          x.pitch = Math.max(0, Math.min(127, o.pitch + dp));
        }
      });
      if (dp !== lastPitchDelta) { lastPitchDelta = dp; previewNote(track.id, n.pitch + dp, n.velocity); }
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  const deleteNotes = (ids: string[]) => {
    if (!ids.length) return;
    editNotes('Delete notes', (ns, c) => { c.notes = ns.filter((x) => !ids.includes(x.id)); }, false);
    setSelected([]);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.stopPropagation(); e.preventDefault(); deleteNotes(selected); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); setSelected(clip.notes.map((n) => n.id)); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
      editNotes('Transpose notes', (ns) => { for (const x of ns) if (selected.includes(x.id)) x.pitch = Math.max(0, Math.min(127, x.pitch + d)); });
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault(); e.stopPropagation();
      const sel = clip.notes.filter((n) => selected.includes(n.id));
      if (!sel.length) return;
      const span = Math.max(...sel.map((n) => n.start + n.duration)) - Math.min(...sel.map((n) => n.start));
      const copies = sel.map((n) => ({ ...n, id: uid(), start: n.start + Math.ceil(span / (grid || 0.25)) * (grid || 0.25) })).filter((n) => n.start < clip.length);
      editNotes('Duplicate notes', (ns) => { ns.push(...copies); }, false);
      setSelected(copies.map((n) => n.id));
    }
  };

  const rows = useMemo(() => Array.from({ length: ROWS }, (_, i) => HIGH - i), []);
  const color = track.color;

  return (
    <div className="roll">
      <div className="roll-tools">
        <input type="text" value={clip.name} aria-label="Clip name" onChange={(e) => editNotes('Rename clip', (_, c) => { c.name = e.target.value; })} />
        <label className="group">Bars
          <input type="number" min={0.25} step={0.25} value={Math.round((clip.length / bpb) * 100) / 100} aria-label="Clip length in bars" onChange={(e) => { const v = Number(e.target.value); if (v > 0) editNotes('Clip length', (_, c) => { c.length = v * bpb; }); }} />
        </label>
        <label className="group">Grid
          <select value={grid} onChange={(e) => setGrid(Number(e.target.value))} aria-label="Grid">
            <option value={1}>1/4</option><option value={0.5}>1/8</option><option value={1 / 3}>1/8T</option><option value={0.25}>1/16</option><option value={1 / 6}>1/16T</option><option value={0.125}>1/32</option><option value={0}>Off</option>
          </select>
        </label>
        <div className="group">
          <button className="btn" onClick={() => editNotes('Quantize', (_, c) => { transformNotes(c, 'quantize', grid || 0.25, project.key); }, false)}>Quantize</button>
          <button className="btn" onClick={() => editNotes('Snap to key', (_, c) => { transformNotes(c, 'snap_to_key', undefined, project.key); }, false)} title="Move out-of-key notes into the song key">Fix key</button>
          <button className="btn" onClick={() => editNotes('Octave down', (_, c) => { transformNotes(c, 'octave', -1, project.key); }, false)}>−8va</button>
          <button className="btn" onClick={() => editNotes('Octave up', (_, c) => { transformNotes(c, 'octave', 1, project.key); }, false)}>+8va</button>
        </div>
        <div className="group">
          <button className="btn icon" onClick={() => setPpb((z) => Math.max(16, z / 1.25))} aria-label="Zoom out">−</button>
          <button className="btn icon" onClick={() => setPpb((z) => Math.min(400, z * 1.25))} aria-label="Zoom in">+</button>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn" style={{ color: 'var(--agent)' }} onClick={() => openInlineAI([clip.id])} title="Ask the agent to change this clip (Ctrl+K)"><Sparkles size={14} /> Edit with AI</button>
      </div>
      <div className="roll-body" ref={bodyRef} tabIndex={0} onKeyDown={onKey}>
        <div className="keys" style={{ height: ROWS * ROW }}>
          {rows.map((p, i) => {
            const black = BLACK.has(p % 12);
            return (
              <div
                key={p}
                className={`key ${black ? 'black' : 'white'} ${p % 12 === 0 ? 'c' : ''}`}
                style={{ top: i * ROW, height: ROW }}
                onPointerDown={() => previewNote(track.id, p, 0.8)}
              >
                {p % 12 === 0 ? midiToNote(p) : ''}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            className="grid"
            style={{
              width,
              height: ROWS * ROW,
              backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px)${grid > 0 && grid < 1 ? ', linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px)' : ''}`,
              backgroundSize: `${bpb * ppb}px 100%, ${ppb}px 100%${grid > 0 && grid < 1 ? `, ${grid * ppb}px 100%` : ''}`,
            }}
            onPointerDown={onGridDown}
            onContextMenu={(e) => e.preventDefault()}
          >
            {rows.map((p, i) => (
              <div key={p} className="row-bg" style={{ top: i * ROW, height: ROW, background: BLACK.has(p % 12) ? 'rgba(0,0,0,0.22)' : isInKey(p, project.key) ? 'rgba(182,156,255,0.035)' : 'transparent', borderBottom: p % 12 === 0 ? '1px solid rgba(255,255,255,0.08)' : undefined, pointerEvents: 'none' }} />
            ))}
            <div style={{ position: 'absolute', left: clip.length * ppb, top: 0, bottom: 0, right: 0, background: 'rgba(0,0,0,0.35)', pointerEvents: 'none' }} />
            {clip.notes.map((n) => (
              <div
                key={n.id}
                className={`note ${selected.includes(n.id) ? 'selected' : ''}`}
                style={{ left: n.start * ppb, top: (HIGH - n.pitch) * ROW + 1, width: Math.max(4, n.duration * ppb - 1), height: ROW - 2, ['--c' as string]: color, opacity: 0.45 + n.velocity * 0.55 }}
                onPointerDown={(e) => onNoteDown(e, n, 'move')}
                onDoubleClick={() => deleteNotes([n.id])}
                onContextMenu={(e) => { e.preventDefault(); deleteNotes([n.id]); }}
                title={`${midiToNote(n.pitch)} · velocity ${Math.round(n.velocity * 127)}`}
              >
                <div className="nresize" onPointerDown={(e) => onNoteDown(e, n, 'resize')} />
              </div>
            ))}
          </div>
          <VelocityLane clip={clip} ppb={ppb} width={width} color={color} selected={selected} onEdit={editNotes} />
        </div>
      </div>
    </div>
  );
}

function VelocityLane({ clip, ppb, width, color, selected, onEdit }: { clip: MidiClip; ppb: number; width: number; color: string; selected: string[]; onEdit: (label: string, fn: (ns: Note[]) => void) => void }) {
  const H = 56;
  const set = (e: RPointerEvent | PointerEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const beat = (e.clientX - rect.left) / ppb;
    const v = Math.max(0.05, Math.min(1, 1 - (e.clientY - rect.top) / H));
    const target = clip.notes.reduce<Note | null>((best, n) => (Math.abs(n.start - beat) < 0.2 && (!best || Math.abs(n.start - beat) < Math.abs(best.start - beat)) ? n : best), null);
    if (!target) return;
    const ids = selected.includes(target.id) ? selected : [target.id];
    onEdit('Velocity', (ns) => { for (const n of ns) if (ids.includes(n.id) || Math.abs(n.start - target.start) < 1e-6 && ids.length === 1 && n.id === target.id) n.velocity = v; });
  };
  return (
    <div
      className="velocity"
      style={{ width, position: 'sticky', bottom: 0 }}
      onPointerDown={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        set(e, el);
        const mv = (ev: PointerEvent) => set(ev, el);
        const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', mv);
        el.addEventListener('pointerup', up);
      }}
      title="Drag to set note velocity"
    >
      {clip.notes.map((n) => (
        <div key={n.id} className="vel-bar" style={{ left: n.start * ppb, height: n.velocity * (H - 4), ['--c' as string]: selected.includes(n.id) ? '#fff' : color }} />
      ))}
    </div>
  );
}
