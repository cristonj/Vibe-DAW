import { useMemo } from 'react';
import { Play, Trash, Plus } from 'lucide-react';
import { useDaw } from '../../state/store';
import { EFFECTS, EFFECT_BY_TYPE, PRESETS, PRESET_BY_ID, defaultEffectParams, defaultPresetParams } from '../../model/catalog';
import type { Effect, EffectType, Project, Track } from '../../model/types';
import { mintId } from '../../model/project';
import { useLibrary } from '../../samples/library';
import { previewNote } from '../../engine/api';

export function ParamSlider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const s = step ?? (max - min > 200 ? 1 : max - min > 20 ? 0.1 : 0.01);
  return (
    <div className="param">
      <span title={label}>{label}</span>
      <input type="range" min={min} max={max} step={s} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <span className="val">{format ? format(value) : Math.round(value * 100) / 100}</span>
    </div>
  );
}

function EffectCard({ fx, onChange, onRemove, project }: { fx: Effect; onChange: (fn: (e: Effect) => void) => void; onRemove: () => void; project: Project }) {
  const info = EFFECT_BY_TYPE[fx.type];
  return (
    <div className="card" style={{ opacity: fx.enabled ? 1 : 0.55 }}>
      <div className="card-head">
        <input type="checkbox" checked={fx.enabled} onChange={(e) => onChange((x) => { x.enabled = e.target.checked; })} aria-label={`Enable ${info.name}`} style={{ accentColor: 'var(--agent)' }} />
        {info.name}
        <span className="chip">{fx.id}</span>
        <div className="spacer" />
        <button className="btn icon danger" onClick={onRemove} aria-label={`Remove ${info.name}`}><Trash size={13} /></button>
      </div>
      {Object.entries(info.params).map(([k, spec]) => {
        const v = fx.params[k] ?? spec.default;
        if (k === 'source') {
          return (
            <div className="param" key={k}>
              <span>Trigger</span>
              <select value={String(v)} onChange={(e) => onChange((x) => { x.params.source = e.target.value; })} aria-label="Duck trigger track">
                <option value="">Choose track…</option>
                {project.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <span />
            </div>
          );
        }
        if (spec.options) {
          return (
            <div className="param" key={k}>
              <span>{spec.label}</span>
              <select value={String(v)} onChange={(e) => onChange((x) => { x.params[k] = e.target.value; })} aria-label={spec.label}>
                {spec.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <span />
            </div>
          );
        }
        return <ParamSlider key={k} label={spec.label} value={Number(v)} min={spec.min ?? 0} max={spec.max ?? 1} onChange={(nv) => onChange((x) => { x.params[k] = nv; })} />;
      })}
    </div>
  );
}

export function EffectChain({ ownerId, effects, project }: { ownerId: string | 'master'; effects: Effect[]; project: Project }) {
  const update = useDaw((s) => s.update);
  const list = (d: Project) => (ownerId === 'master' ? d.master.effects : d.tracks.find((t) => t.id === ownerId)!.effects);
  return (
    <>
      {effects.map((fx) => (
        <EffectCard
          key={fx.id}
          fx={fx}
          project={project}
          onChange={(fn) => update(`Edit ${EFFECT_BY_TYPE[fx.type].name}`, (d) => { const e = list(d).find((x) => x.id === fx.id); if (e) fn(e); }, { coalesce: true })}
          onRemove={() => update('Remove effect', (d) => { const l = list(d); l.splice(l.findIndex((x) => x.id === fx.id), 1); })}
        />
      ))}
      <div className="card" style={{ justifyContent: 'center' }}>
        <div className="card-head"><Plus size={14} /> Add effect</div>
        <select
          value=""
          onChange={(e) => {
            const type = e.target.value as EffectType;
            if (!type) return;
            update(`Add ${EFFECT_BY_TYPE[type].name}`, (d) => {
              const l = list(d);
              const fx = { id: mintId(d, 'fx'), type, enabled: true, params: defaultEffectParams(type) };
              if (ownerId === 'master' && l.length && l[l.length - 1].type === 'limiter' && type !== 'limiter') l.splice(l.length - 1, 0, fx);
              else l.push(fx);
            });
          }}
          aria-label="Add effect"
        >
          <option value="">Choose…</option>
          {EFFECTS.map((e) => <option key={e.type} value={e.type}>{e.name} — {e.description}</option>)}
        </select>
      </div>
    </>
  );
}

function DrumKit({ track }: { track: Track }) {
  const update = useDaw((s) => s.update);
  const samples = useLibrary((s) => s.samples);
  const options = useMemo(() => Object.values(samples).filter((m) => m.kind === 'oneshot' || m.duration < 3).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)), [samples]);
  const setLane = (id: string, fn: (l: NonNullable<Track['drumLanes']>[number]) => void) => update('Edit drum lane', (d) => {
    const l = d.tracks.find((t) => t.id === track.id)?.drumLanes?.find((x) => x.id === id);
    if (l) fn(l);
  }, { coalesce: true });
  return (
    <div className="card" style={{ gridColumn: 'span 2' }}>
      <div className="card-head">Drum kit</div>
      {(track.drumLanes ?? []).map((l) => (
        <div className="lane-row" key={l.id}>
          <b>{l.name}</b>
          <select value={l.sampleId} onChange={(e) => setLane(l.id, (x) => { x.sampleId = e.target.value; })} aria-label={`${l.name} sample`}>
            {!samples[l.sampleId] && <option value={l.sampleId}>{l.sampleId}</option>}
            {options.map((m) => <option key={m.id} value={m.id}>{m.category} · {m.name}</option>)}
          </select>
          <input type="number" step={0.5} value={l.gainDb} onChange={(e) => setLane(l.id, (x) => { x.gainDb = Number(e.target.value); })} aria-label={`${l.name} gain dB`} title="Gain dB" />
          <button className="btn icon" onClick={() => previewNote(track.id, l.note, 0.9)} aria-label={`Preview ${l.name}`}><Play size={11} fill="currentColor" /></button>
        </div>
      ))}
    </div>
  );
}

export function TrackInspector({ track, project }: { track: Track | null; project: Project }) {
  const update = useDaw((s) => s.update);
  if (!track) {
    return (
      <div className="inspector">
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-head">Master bus</div>
          <ParamSlider label="Volume (dB)" value={project.master.volumeDb} min={-24} max={6} step={0.5} onChange={(v) => update('Master volume', (d) => { d.master.volumeDb = v; }, { coalesce: true })} />
        </div>
        <EffectChain ownerId="master" effects={project.master.effects} project={project} />
      </div>
    );
  }
  const preset = track.instrument ? PRESET_BY_ID[track.instrument.preset] : null;
  const setTrack = (label: string, fn: (t: Track) => void) => update(label, (d) => { const t = d.tracks.find((x) => x.id === track.id); if (t) fn(t); }, { coalesce: true });
  return (
    <div className="inspector">
      {track.kind === 'instrument' && track.instrument && (
        <div className="card">
          <div className="card-head">Instrument</div>
          <select
            value={track.instrument.preset}
            onChange={(e) => setTrack('Change instrument', (t) => { t.instrument = { preset: e.target.value, params: defaultPresetParams(e.target.value) }; })}
            aria-label="Instrument preset"
          >
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {preset && <small style={{ color: 'var(--faint)' }}>{preset.description}</small>}
          {preset && Object.entries(preset.params).map(([k, spec]) => (
            <ParamSlider key={k} label={spec.label} value={track.instrument!.params[k] ?? spec.default} min={spec.min} max={spec.max} onChange={(v) => setTrack('Instrument param', (t) => { t.instrument!.params[k] = v; })} />
          ))}
        </div>
      )}
      {track.kind === 'drums' && <DrumKit track={track} />}
      <EffectChain ownerId={track.id} effects={track.effects} project={project} />
    </div>
  );
}
