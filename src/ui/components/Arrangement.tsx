import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ZoomIn, ZoomOut, Plus, Drum, Piano, AudioLines, Trash, Sparkles, Check } from 'lucide-react';
import { useDaw, useTransport } from '../../state/store';
import { beatsPerBar, createAudioClip, createMidiClip, createTrack, projectLength, secondsToBeats } from '../../model/project';
import { PRESET_BY_ID } from '../../model/catalog';
import type { AudioClip, Clip, MidiClip, Project, Track } from '../../model/types';
import { seek } from '../../engine/engine';
import { getSampleMeta } from '../../samples/library';
import { audioClipRate } from '../../model/edit';
import { usePeaks } from '../hooks';
import { keepAllPending, runAgent, useAgent } from '../../agent/agent';

const HEADER_W = 200;
const TRACK_H = 68;

const SNAPS: Array<[string, number]> = [['Bar', 0], ['1/4', 1], ['1/8', 0.5], ['1/16', 0.25], ['Off', -1]];

function snapBeat(beat: number, snap: number, bpb: number) {
  const grid = snap === 0 ? bpb : snap;
  if (grid < 0) return beat;
  return Math.round(beat / grid) * grid;
}

// ---------------------------------------------------------------- clip bodies

const MidiBody = memo(function MidiBody({ clip, track }: { clip: MidiClip; track: Track }) {
  if (!clip.notes.length) return null;
  if (track.kind === 'drums') {
    const lanes = track.drumLanes ?? [];
    const idx = new Map(lanes.map((l, i) => [l.note, i]));
    const rows = Math.max(1, lanes.length);
    return (
      <svg viewBox={`0 0 ${clip.length} ${rows}`} preserveAspectRatio="none" aria-hidden>
        {clip.notes.map((n) => {
          const r = idx.get(n.pitch);
          if (r === undefined || n.start >= clip.length) return null;
          return <rect key={n.id} x={n.start} y={r + 0.15} width={Math.min(0.12, clip.length / 64)} height={0.7} fill="rgba(255,255,255,0.75)" opacity={0.4 + n.velocity * 0.6} />;
        })}
      </svg>
    );
  }
  let lo = 127, hi = 0;
  for (const n of clip.notes) { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); }
  const span = Math.max(12, hi - lo + 3);
  const top = hi + 2;
  return (
    <svg viewBox={`0 0 ${clip.length} ${span}`} preserveAspectRatio="none" aria-hidden>
      {clip.notes.map((n) => (n.start < clip.length ? <rect key={n.id} x={n.start} y={top - n.pitch - 1} width={Math.max(0.05, Math.min(n.duration, clip.length - n.start))} height={0.9} rx={0.08} fill="rgba(255,255,255,0.82)" /> : null))}
    </svg>
  );
});

function AudioBody({ clip, project, widthPx }: { clip: AudioClip; project: Project; widthPx: number }) {
  const peaks = usePeaks(clip.sampleId, clip.reverse);
  const ref = useRef<HTMLCanvasElement>(null);
  const meta = getSampleMeta(clip.sampleId);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv || !peaks || !meta) return;
    const w = Math.min(4096, Math.max(1, Math.round(widthPx)));
    const h = TRACK_H - 22;
    cv.width = w * devicePixelRatio;
    cv.height = h * devicePixelRatio;
    const g = cv.getContext('2d')!;
    g.scale(devicePixelRatio, devicePixelRatio);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    const rate = audioClipRate(project, clip, meta.bpm);
    const secPerPx = ((clip.length * 60) / project.bpm / w) * rate;
    const dur = meta.duration;
    for (let x = 0; x < w; x++) {
      let t = clip.offset + x * secPerPx;
      if (clip.loop && dur > 0) t = t % dur;
      if (t >= dur) break;
      const idx = Math.floor((t / dur) * peaks.length);
      const v = peaks[Math.min(peaks.length - 1, idx)] * (h / 2 - 1) * Math.pow(10, clip.gainDb / 20);
      g.fillRect(x, h / 2 - v, 1, Math.max(1, v * 2));
    }
  }, [peaks, widthPx, clip, project.bpm, meta]);
  if (!meta) return null;
  return <canvas ref={ref} aria-hidden />;
}

// ---------------------------------------------------------------- clip

function ClipView({ clip, track, project, zoom, selected, onPointerDown, onDoubleClick }: {
  clip: Clip; track: Track; project: Project; zoom: number; selected: boolean;
  onPointerDown: (e: RPointerEvent, mode: 'move' | 'resize') => void;
  onDoubleClick: () => void;
}) {
  const w = clip.length * zoom;
  return (
    <div
      className={`clip ${selected ? 'selected' : ''} ${clip.muted ? 'muted' : ''} ${clip.aiPending ? 'ai' : ''}`}
      style={{ left: clip.start * zoom, width: Math.max(4, w), ['--c' as string]: track.color }}
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onDoubleClick={onDoubleClick}
      title={`${clip.name}${clip.aiPending ? ' — made by the agent (not reviewed yet)' : ''}`}
    >
      <div className="cname">{clip.name}</div>
      {clip.type === 'midi' ? <MidiBody clip={clip} track={track} /> : <AudioBody clip={clip} project={project} widthPx={w} />}
      <div className="resize" onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, 'resize'); }} />
    </div>
  );
}

// ---------------------------------------------------------------- ruler

function Ruler({ project, zoom, width }: { project: Project; zoom: number; width: number }) {
  const bpb = beatsPerBar(project);
  const bars = Math.ceil(width / zoom / bpb);
  const update = useDaw((s) => s.update);
  const snap = useDaw((s) => s.snap);
  const every = zoom * bpb < 26 ? 4 : zoom * bpb < 50 ? 2 : 1;
  const loopRef = useRef<{ startBeat: number } | null>(null);

  const beatAt = (e: RPointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.max(0, (e.clientX - rect.left) / zoom);
  };

  return (
    <div className="ruler">
      <div className="corner" style={{ ['--header-w' as string]: `${HEADER_W}px` }}>
        <span className="chip">{project.tracks.length} tracks</span>
      </div>
      <div
        className="marks"
        style={{ width }}
        onPointerDown={(e) => {
          const b = beatAt(e);
          if (e.shiftKey) {
            const s = snapBeat(b, snap === -1 ? 0 : snap, bpb);
            loopRef.current = { startBeat: s };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } else {
            seek(snapBeat(b, 0.25, bpb));
          }
        }}
        onPointerMove={(e) => {
          if (!loopRef.current) return;
          const b = snapBeat(beatAt(e), snap <= 0 ? bpb : snap, bpb);
          const a = loopRef.current.startBeat;
          if (Math.abs(b - a) < 0.25) return;
          update('Set loop', (d) => { d.loop = { enabled: true, start: Math.min(a, b), end: Math.max(a, b) }; }, { coalesce: true });
        }}
        onPointerUp={() => { loopRef.current = null; }}
        title="Click to move the playhead · Shift-drag to set the loop"
      >
        {Array.from({ length: bars + 1 }, (_, i) => (
          <div key={i}>
            <div className="bar-tick" style={{ left: i * bpb * zoom }} />
            {i % every === 0 && <div className="bar-num" style={{ left: i * bpb * zoom }}>{i + 1}</div>}
          </div>
        ))}
        {project.sections.map((s) => (
          <div key={s.id} className="section" style={{ left: s.start * zoom, width: Math.max(10, s.length * zoom - 2) }}>{s.name}</div>
        ))}
        {project.loop.end > project.loop.start && (
          <div className={`loop-region ${project.loop.enabled ? 'on' : ''}`} style={{ left: project.loop.start * zoom, width: (project.loop.end - project.loop.start) * zoom }} />
        )}
      </div>
    </div>
  );
}

function Playhead({ zoom, scroller }: { zoom: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const pos = useTransport((s) => s.position);
  const playing = useTransport((s) => s.playing);
  const follow = useDaw((s) => s.followPlayhead);
  const x = HEADER_W + pos * zoom;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing || !follow) return;
    const visibleRight = el.scrollLeft + el.clientWidth;
    if (x > visibleRight - 60 || x < el.scrollLeft + HEADER_W) el.scrollLeft = Math.max(0, x - HEADER_W - 80);
  }, [x, playing, follow, scroller]);
  return <div className="playhead" style={{ left: x }} />;
}

// ---------------------------------------------------------------- empty state

const STARTERS = [
  'Make a Lil Peep type beat',
  'Dark UK drill beat, 142 BPM',
  'Lo-fi study beat with dusty drums',
  'Bouncy pluggnb beat with bells',
  'Rage beat with huge supersaws',
];

function EmptyHero() {
  const [text, setText] = useState('');
  const running = useAgent((s) => s.running);
  const go = (t: string) => { if (t.trim()) void runAgent(t); };
  return (
    <div className="empty-arrange" style={{ ['--header-w' as string]: `${HEADER_W}px` }}>
      <div className="hero-card">
        <h1>Describe the beat in your head.</h1>
        <p>The agent picks sounds by ear, writes the parts, arranges and mixes them — then you take it from there.</p>
        <form className="hero-input" onSubmit={(e) => { e.preventDefault(); go(text); }}>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. sad emo trap beat with an acoustic guitar loop" aria-label="Describe a beat" disabled={running} />
          <button className="btn primary" type="submit" disabled={running || !text.trim()}><Sparkles size={15} /> Make it</button>
        </form>
        <div className="suggestions">
          {STARTERS.map((s) => <button key={s} className="suggestion" onClick={() => go(s)} disabled={running}>{s}</button>)}
        </div>
        <div className="hero-foot">Prefer to start by hand? Add a track below or drag a sound from the browser.</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- main

export function Arrangement() {
  const project = useDaw((s) => s.project);
  const zoom = useDaw((s) => s.zoom);
  const snap = useDaw((s) => s.snap);
  const selection = useDaw((s) => s.selection);
  const follow = useDaw((s) => s.followPlayhead);
  const { update, select, openEditor, setZoom, setSnap, setFollow } = useDaw.getState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const bpb = beatsPerBar(project);
  const totalBeats = projectLength(project) + bpb * 16;
  const width = totalBeats * zoom;
  const hasPending = useMemo(() => project.tracks.some((t) => t.clips.some((c) => c.aiPending)), [project]);
  const empty = project.tracks.length === 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseBeat = (el.scrollLeft + e.clientX - rect.left - HEADER_W) / useDaw.getState().zoom;
      const nz = Math.max(4, Math.min(200, useDaw.getState().zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      useDaw.getState().setZoom(nz);
      requestAnimationFrame(() => { el.scrollLeft = mouseBeat * nz - (e.clientX - rect.left - HEADER_W); });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const startDrag = (e: RPointerEvent, clip: Clip, track: Track, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const ids = additive
      ? (selection.clipIds.includes(clip.id) ? selection.clipIds.filter((x) => x !== clip.id) : [...selection.clipIds, clip.id])
      : selection.clipIds.includes(clip.id) ? selection.clipIds : [clip.id];
    select({ clipIds: ids, trackId: track.id });
    if (additive) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    const origStart = clip.start, origLen = clip.length;
    const tIdx = project.tracks.findIndex((t) => t.id === track.id);
    let duplicated = false;
    let moved = false;
    let currentClipId = clip.id;
    const onMove = (ev: PointerEvent) => {
      const dxBeats = (ev.clientX - sx) / zoom;
      if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
      moved = true;
      const s = useDaw.getState().snap;
      if (mode === 'resize') {
        const end = snapBeat(origStart + origLen + dxBeats, s, bpb);
        const len = Math.max(s > 0 ? s : 0.25, end - origStart);
        update('Resize clip', (d) => {
          for (const t of d.tracks) for (const c of t.clips) if (c.id === clip.id) c.length = len;
        }, { coalesce: true });
        return;
      }
      const newStart = Math.max(0, snapBeat(origStart + dxBeats, s, bpb));
      const dRows = Math.round((ev.clientY - sy) / TRACK_H);
      update('Move clip', (d) => {
        if (ev.altKey && !duplicated) {
          // Alt-drag leaves a copy behind.
          const src = d.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id);
          const tr = d.tracks.find((t) => t.clips.some((c) => c.id === clip.id));
          if (src && tr) {
            d.nextId++;
            const copy = { ...structuredClone(src), id: `c${d.nextId}` };
            tr.clips.push(copy);
            currentClipId = copy.id;
            duplicated = true;
          }
        }
        let fromTrack: Track | undefined;
        let c: Clip | undefined;
        for (const t of d.tracks) { const f = t.clips.find((x) => x.id === currentClipId); if (f) { fromTrack = t; c = f; } }
        if (!c || !fromTrack) return;
        c.start = newStart;
        const target = d.tracks[Math.max(0, Math.min(d.tracks.length - 1, tIdx + dRows))];
        const compatible = target && target !== fromTrack && (c.type === 'audio' ? target.kind === 'audio' : target.kind === fromTrack.kind);
        if (compatible) {
          fromTrack.clips = fromTrack.clips.filter((x) => x.id !== c!.id);
          target.clips.push(c);
        }
      }, { coalesce: true });
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      if (duplicated) select({ clipIds: [currentClipId] });
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  const laneDoubleClick = (e: React.MouseEvent, track: Track) => {
    if (track.kind === 'audio') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const beat = Math.floor((e.clientX - rect.left) / zoom / bpb) * bpb;
    let id = '';
    update('New clip', (d) => {
      const t = d.tracks.find((x) => x.id === track.id)!;
      const c = createMidiClip(d, beat, bpb * (track.kind === 'drums' ? 1 : 2), track.kind === 'drums' ? 'Beat' : 'Pattern');
      t.clips.push(c);
      id = c.id;
    });
    select({ clipIds: [id], trackId: track.id });
    openEditor(id);
  };

  const onLaneDrop = (e: React.DragEvent, track: Track | null) => {
    e.preventDefault();
    setDropTrack(null);
    const sampleId = e.dataTransfer.getData('application/x-vibe-sample');
    const preset = e.dataTransfer.getData('application/x-vibe-preset');
    if (preset) {
      update('Add track', (d) => { d.tracks.push(createTrack(d, 'instrument', { preset })); });
      return;
    }
    if (!sampleId) return;
    const meta = getSampleMeta(sampleId);
    if (!meta) return;
    const lane = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const beat = Math.max(0, snapBeat((e.clientX - lane.left) / zoom, snap <= 0 ? bpb : snap, bpb));
    update(`Place ${meta.name}`, (d) => {
      let t = track && track.kind === 'audio' ? d.tracks.find((x) => x.id === track.id) : undefined;
      if (!t) { t = createTrack(d, 'audio', { name: meta.name.slice(0, 24) }); d.tracks.push(t); }
      const len = meta.bpm ? (meta.duration * meta.bpm) / 60 : secondsToBeats(d, meta.duration);
      const c = createAudioClip(d, sampleId, track ? beat : 0, len, meta.name);
      if (meta.bpm && Math.abs(meta.bpm - d.bpm) > 0.01) c.warp = meta.category === 'loop' || meta.category === 'guitar' || meta.category === 'keys' ? 'stretch' : 'resample';
      t.clips.push(c);
    });
  };

  const laneBg = (i: number) => ({
    width,
    backgroundColor: i % 2 ? 'var(--lane-b)' : 'var(--lane-a)',
    backgroundImage: `linear-gradient(to right, var(--grid-bar) 1px, transparent 1px), linear-gradient(to right, var(--grid-beat) 1px, transparent 1px)`,
    backgroundSize: `${bpb * zoom}px 100%, ${zoom}px 100%`,
  });

  const addTrack = (kind: 'instrument' | 'drums' | 'audio') => {
    update('Add track', (d) => { d.tracks.push(createTrack(d, kind, kind === 'instrument' ? { preset: 'piano' } : {})); });
  };

  return (
    <section className="arrange" style={{ ['--header-w' as string]: `${HEADER_W}px`, ['--track-h' as string]: `${TRACK_H}px` }} aria-label="Arrangement">
      <div className="arrange-tools">
        <button className="btn icon" title="Zoom out" onClick={() => setZoom(zoom / 1.3)}><ZoomOut size={15} /></button>
        <button className="btn icon" title="Zoom in" onClick={() => setZoom(zoom * 1.3)}><ZoomIn size={15} /></button>
        <label>Snap
          <select value={snap} onChange={(e) => setSnap(Number(e.target.value))} aria-label="Snap">
            {SNAPS.map(([l, v]) => <option key={l} value={v}>{l}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow</label>
        <div style={{ flex: 1 }} />
        {hasPending && (
          <button className="btn" style={{ color: 'var(--agent)' }} onClick={keepAllPending} title="Accept everything the agent changed">
            <Check size={14} /> Keep AI changes
          </button>
        )}
      </div>
      <div className="scroller" ref={scrollRef} onPointerDown={(e) => { if (e.target === e.currentTarget) select({ clipIds: [] }); }}>
        <div className="timeline" style={{ width: HEADER_W + width }}>
          <Ruler project={project} zoom={zoom} width={width} />
          {project.tracks.map((t, i) => (
            <div className="track-row" key={t.id}>
              <TrackHeader track={t} selected={selection.trackId === t.id} />
              <div
                className={`lane ${dropTrack === t.id ? 'drop-target' : ''}`}
                style={laneBg(i)}
                onPointerDown={(e) => { if (e.target === e.currentTarget) select({ clipIds: [], trackId: t.id }); }}
                onDoubleClick={(e) => { if (e.target === e.currentTarget) laneDoubleClick(e, t); }}
                onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-vibe-sample')) { e.preventDefault(); setDropTrack(t.id); } }}
                onDragLeave={() => setDropTrack(null)}
                onDrop={(e) => onLaneDrop(e, t)}
              >
                {t.clips.map((c) => (
                  <ClipView
                    key={c.id}
                    clip={c}
                    track={t}
                    project={project}
                    zoom={zoom}
                    selected={selection.clipIds.includes(c.id)}
                    onPointerDown={(e, mode) => startDrag(e, c, t, mode)}
                    onDoubleClick={() => openEditor(c.id)}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="add-track-row">
            <div className="track-head">
              <button className="btn" onClick={() => addTrack('drums')} title="Add drum track"><Drum size={14} /> Drums</button>
              <button className="btn" onClick={() => addTrack('instrument')} title="Add instrument track"><Piano size={14} /> Synth</button>
              <button className="btn icon" onClick={() => addTrack('audio')} title="Add audio track"><AudioLines size={14} /></button>
            </div>
            <div
              className={`lane ${dropTrack === '__new' ? 'drop-target' : ''}`}
              style={{ width, display: 'flex', alignItems: 'center', paddingLeft: 12, color: 'var(--faint)', fontSize: 12 }}
              onDragOver={(e) => { e.preventDefault(); setDropTrack('__new'); }}
              onDragLeave={() => setDropTrack(null)}
              onDrop={(e) => onLaneDrop(e, null)}
            >
              <Plus size={13} />&nbsp;Drop a sound or instrument here for a new track
            </div>
          </div>
          <Playhead zoom={zoom} scroller={scrollRef} />
        </div>
        {empty && <EmptyHero />}
      </div>
    </section>
  );
}

function TrackHeader({ track, selected }: { track: Track; selected: boolean }) {
  const { update, select, setBottom } = useDaw.getState();
  const sub = track.kind === 'instrument' ? PRESET_BY_ID[track.instrument?.preset ?? '']?.name ?? track.instrument?.preset : track.kind === 'drums' ? `Drum kit · ${track.drumLanes?.length ?? 0} lanes` : 'Audio';
  const set = (label: string, fn: (t: Track) => void) => update(label, (d) => { const t = d.tracks.find((x) => x.id === track.id); if (t) fn(t); });
  return (
    <div className={`track-head ${selected ? 'selected' : ''}`} onPointerDown={() => select({ trackId: track.id })} onDoubleClick={() => setBottom('editor')}>
      <div className="swatch" style={{ background: track.color }} />
      <input className="tname" value={track.name} aria-label="Track name" onChange={(e) => update('Rename track', (d) => { const t = d.tracks.find((x) => x.id === track.id); if (t) t.name = e.target.value; }, { coalesce: true })} />
      <div className="tbtns">
        <button className={`ms m ${track.mute ? 'on' : ''}`} title="Mute" onClick={() => set('Mute', (t) => { t.mute = !t.mute; })}>M</button>
        <button className={`ms s ${track.solo ? 'on' : ''}`} title="Solo" onClick={() => set('Solo', (t) => { t.solo = !t.solo; })}>S</button>
      </div>
      <div className="tsub" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
        <button className="btn icon danger" style={{ width: 18, height: 18, marginLeft: 'auto' }} title="Delete track" onClick={(e) => { e.stopPropagation(); update(`Delete ${track.name}`, (d) => { d.tracks = d.tracks.filter((x) => x.id !== track.id); }); }}><Trash size={12} /></button>
      </div>
    </div>
  );
}
