import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useDaw } from '../../state/store';
import { findClip, findTrack } from '../../model/project';
import { PianoRoll } from './PianoRoll';
import { DrumEditor } from './DrumEditor';
import { AudioEditor } from './AudioEditor';
import { Mixer } from './Mixer';
import { TrackInspector } from './Inspector';

export function Dock() {
  const project = useDaw((s) => s.project);
  const panel = useDaw((s) => s.bottomPanel);
  const open = useDaw((s) => s.bottomOpen);
  const editorClipId = useDaw((s) => s.editorClipId);
  const selectedTrack = useDaw((s) => s.selection.trackId);
  const { setBottom, toggleBottom } = useDaw.getState();
  const [height, setHeight] = useState(300);
  const drag = useRef<{ y: number; h: number } | null>(null);

  const found = editorClipId ? findClip(project, editorClipId) : undefined;
  const inspectTrack = selectedTrack ? findTrack(project, selectedTrack) ?? null : found?.track ?? null;

  let editor: React.ReactNode = <div className="dock-empty">Double-click a clip on the timeline to edit it here.<br />No clips yet? Select a track and click <b>New clip</b> in the toolbar.</div>;
  if (found) {
    const { clip, track } = found;
    if (clip.type === 'audio') editor = <AudioEditor clip={clip} track={track} project={project} />;
    else if (track.kind === 'drums') editor = <DrumEditor clip={clip} track={track} project={project} />;
    else editor = <PianoRoll clip={clip} track={track} project={project} />;
  }

  return (
    <section className="dock" style={{ height: open ? height : 34 }} aria-label="Editor dock">
      {open && (
        <div
          className="dock-resize"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, h: height };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            setHeight(Math.max(140, Math.min(window.innerHeight - 220, drag.current.h - (e.clientY - drag.current.y))));
          }}
          onPointerUp={() => { drag.current = null; }}
        />
      )}
      <div className="dock-head">
        <button className={`tab ${panel === 'editor' ? 'active' : ''}`} onClick={() => setBottom('editor')} title="Edit the notes, drum steps, or audio of the selected clip">Clip editor{found ? ` · ${found.clip.name}` : ''}</button>
        <button className={`tab ${panel === 'mixer' ? 'active' : ''}`} onClick={() => setBottom('mixer')} title="Volume, pan, mute and solo for every track">Mixer</button>
        <button className={`tab ${panel === 'track' ? 'active' : ''}`} onClick={() => setBottom('track')} title="Change the selected track's instrument and effects">{inspectTrack ? `Sound & FX · ${inspectTrack.name}` : 'Master FX'}</button>
        <div className="spacer" />
        <button className="btn icon" onClick={toggleBottom} aria-label={open ? 'Collapse dock' : 'Expand dock'} style={{ transform: open ? 'none' : 'rotate(180deg)' }}><ChevronDown size={16} /></button>
      </div>
      {open && (
        <div className="dock-body">
          {panel === 'editor' && editor}
          {panel === 'mixer' && <Mixer />}
          {panel === 'track' && <TrackInspector track={inspectTrack} project={project} />}
        </div>
      )}
    </section>
  );
}
