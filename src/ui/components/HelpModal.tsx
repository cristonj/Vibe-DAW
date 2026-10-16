import { useEffect } from 'react';

const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play / pause'],
  ['Home', 'Stop and go back to the start'],
  ['L', 'Loop on/off (Shift-drag the ruler to set the loop)'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z', 'Redo'],
  ['Ctrl+D', 'Duplicate selected clips or notes'],
  ['Delete', 'Delete selected clips or notes'],
  ['Ctrl+K', 'Ask the agent to edit the selected clips'],
  ['Ctrl+L', 'Jump to the agent chat'],
  ['Ctrl+scroll', 'Zoom the timeline'],
  ['Alt+drag', 'Copy a clip'],
];

const HOW_TO: Array<[string, string]> = [
  ['Make a beat with AI', 'Type what you want in the Producer panel on the right, e.g. “sad trap beat with guitar”. Everything it adds is outlined in purple until you click Keep.'],
  ['Add a track', 'Use Add track in the toolbar, or drag an instrument or sound from the left panel onto the timeline.'],
  ['Write notes or drums', 'Select a track and click New clip (or double-click an empty spot on its lane). The editor opens at the bottom.'],
  ['Lengthen a pattern', 'Drag its right edge on the timeline. It snaps to whole bars and repeats what is inside (hold Shift for fine steps).'],
  ['Change a sound or add effects', 'Select a track and open the Sound & FX tab at the bottom.'],
  ['Balance levels', 'Open the Mixer tab at the bottom.'],
  ['Use your own samples', 'Click Import audio at the bottom of the left panel, then drag the sample onto the timeline.'],
  ['Save a song', 'Projects save automatically. Use Export (top right) to download an MP3 or WAV.'],
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal help" role="dialog" aria-label="Help">
        <h2>How Vibe works</h2>
        <p className="sub">A DAW you can drive by hand or by asking the Producer.</p>
        <div className="howto">
          {HOW_TO.map(([t, d]) => (
            <div key={t}><b>{t}</b><span>{d}</span></div>
          ))}
        </div>
        <h3>Keyboard shortcuts</h3>
        <table className="shortcuts">
          <tbody>
            {SHORTCUTS.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}
          </tbody>
        </table>
        <div className="modal-actions"><button className="btn primary" onClick={onClose}>Got it</button></div>
      </div>
    </div>
  );
}
