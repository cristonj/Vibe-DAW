import type { ComponentType, ReactNode, SVGProps } from 'react';

// Vibe's icon set, drawn to match the wordmark: round-capped strokes on a 24px grid, with the
// brand's filled dot for punctuation. Icons take the text color. Inside an agent context
// (see .ink in global.css) they paint the accent gradient from <IconDefs /> instead.

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & { size?: number | string; color?: string };
export type Icon = ComponentType<IconProps>;

function icon(name: string, body: ReactNode): Icon {
  const Component = ({ size = 24, color = 'currentColor', strokeWidth = 1.75, className, ...rest }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className ? `icon ${className}` : 'icon'} aria-hidden={rest['aria-label'] ? undefined : true} {...rest}
    >{body}</svg>
  );
  Component.displayName = name;
  return Component;
}

/** The brand's dot, used for punctuation. */
const dot = (cx: number, cy: number, r = 1.15) => <circle className="icon-dot" cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;

/** The shared gradient agent icons paint with. Its stops follow the accent (see theme.ts). */
export function IconDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
      <defs>
        <linearGradient id="vibe-ink" gradientUnits="userSpaceOnUse" x1="3" y1="3" x2="21" y2="21">
          <stop offset="0" style={{ stopColor: 'var(--ink-0)' }} />
          <stop offset="0.5" style={{ stopColor: 'var(--ink-1)' }} />
          <stop offset="1" style={{ stopColor: 'var(--ink-2)' }} />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** A cog with eight teeth: outer radius 9, root radius 6.6. */
const cog = (() => {
  const pts: string[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, w = 0.2, root = 0.3;
    for (const [ang, r] of [[a - root, 6.6], [a - w, 9], [a + w, 9], [a + root, 6.6]] as const)
      pts.push(`${(12 + r * Math.cos(ang)).toFixed(2)} ${(12 + r * Math.sin(ang)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
})();

// Transport and playback
export const Play = icon('Play', <path className="tone" d="M7.5 5.1v13.8a1.1 1.1 0 0 0 1.7.9l10.6-6.9a1.1 1.1 0 0 0 0-1.8L9.2 4.2a1.1 1.1 0 0 0-1.7.9z" />);
export const Pause = icon('Pause', <><rect className="tone" x="6" y="4.5" width="4" height="15" rx="1.5" /><rect className="tone" x="14" y="4.5" width="4" height="15" rx="1.5" /></>);
export const Square = icon('Square', <rect className="tone" x="5.5" y="5.5" width="13" height="13" rx="2.5" />);
export const CircleStop = icon('CircleStop', <><circle className="tone" cx="12" cy="12" r="9" /><rect x="9" y="9" width="6" height="6" rx="1.2" /></>);
export const SkipBack = icon('SkipBack', <><path className="tone" d="M18.5 6v12a1 1 0 0 1-1.6.8L9 12.8a1 1 0 0 1 0-1.6l7.9-6a1 1 0 0 1 1.6.8z" /><path d="M5.5 5v14" /></>);
export const Repeat = icon('Repeat', <><path d="M17 3.5l3 3-3 3" /><path d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20" /><path d="M7 20.5l-3-3 3-3" /><path d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4" /></>);
export const Metronome = icon('Metronome', <><path className="tone" d="M9.6 3.5h4.8a1 1 0 0 1 1 .8l3.5 15a1 1 0 0 1-1 1.2H6.1a1 1 0 0 1-1-1.2l3.5-15a1 1 0 0 1 1-.8z" /><path d="M12 15.5l5-8" /><path d="M7.3 15.5h9.4" /></>);
export const Gauge = icon('Gauge', <><path className="tone" d="M4.6 18a9 9 0 1 1 14.8 0" /><path d="M12 14l4-4.5" />{dot(12, 14, 1.6)}</>);
export const AudioLines = icon('AudioLines', <path d="M3.5 10.5v3M7.5 7v10M11.5 3.5v17M15.5 7.5v9M19.5 10v4" />);
export const Music = icon('Music', <><path d="M9 17.5V5.8a1 1 0 0 1 .8-1l9.2-1.7a1 1 0 0 1 1 1v11.4" /><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="15.5" r="2.5" /></>);
export const Piano = icon('Piano', <><rect className="tone" x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 20v-6M15 20v-6" /><rect x="7.9" y="4" width="2.2" height="9" rx="0.7" fill="currentColor" stroke="none" /><rect x="13.9" y="4" width="2.2" height="9" rx="0.7" fill="currentColor" stroke="none" /></>);
export const Drum = icon('Drum', <><ellipse className="tone" cx="12" cy="10" rx="8" ry="3" /><path d="M4 10v6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V10" /><path d="M4 16.5l3 2M20 16.5l-3 2" /><path d="M6.5 3.5l4.5 5.5M17.5 3.5L13 9" /></>);
export const Mic = icon('Mic', <><rect className="tone" x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></>);
export const Ear = icon('Ear', <><path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 2.6-1.6 3.7-2.6 4.8-.9 1-1.4 1.8-1.4 3.2a3 3 0 0 1-5.6 1.5" /><path d="M9.5 10a2.5 2.5 0 0 1 5 0c0 1.2-.9 1.8-1.5 2.4" /></>);

// Editing
export const Plus = icon('Plus', <path d="M12 5v14M5 12h14" />);
export const X = icon('X', <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
export const Check = icon('Check', <path d="M5 12.5l4.5 4.5L19 7.5" />);
export const Pencil = icon('Pencil', <><path className="tone" d="M15.2 4.8a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L8.5 19.5 4 20l.5-4.5z" /><path d="M13.5 6.5l4 4" /></>);
export const Trash = icon('Trash', <><path d="M4 6.5h16" /><path d="M9.5 6.5v-2A1.5 1.5 0 0 1 11 3h2a1.5 1.5 0 0 1 1.5 1.5v2" /><path className="tone" d="M6 6.5l.9 12.6a2 2 0 0 0 2 1.9h6.2a2 2 0 0 0 2-1.9L18 6.5" /><path d="M10 11v5.5M14 11v5.5" /></>);
export const Scissors = icon('Scissors', <><circle cx="6" cy="6.5" r="2.5" /><circle cx="6" cy="17.5" r="2.5" /><path d="M8.2 7.9L20 18M8.2 16.1L20 6" /></>);
export const Copy = icon('Copy', <><rect className="tone" x="8.5" y="8.5" width="12" height="12" rx="2.5" /><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" /></>);
export const CopyPlus = icon('CopyPlus', <><rect x="8.5" y="8.5" width="12" height="12" rx="2.5" /><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" /><path d="M14.5 11.5v6M11.5 14.5h6" /></>);
export const ClipboardPaste = icon('ClipboardPaste', <><path className="tone" d="M8.5 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1.5" /><rect x="8.5" y="3" width="7" height="4" rx="1.2" /><path d="M12 10.5v6.5M9.5 14.5L12 17l2.5-2.5" /></>);
export const RotateCcw = icon('RotateCcw', <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" /><path d="M4.5 4.5V9H9" /></>);
export const Undo2 = icon('Undo2', <><path d="M9 4.5L4.5 9 9 13.5" /><path d="M4.5 9h10a5 5 0 0 1 0 10H11" /></>);
export const Redo2 = icon('Redo2', <><path d="M15 4.5L19.5 9 15 13.5" /><path d="M19.5 9h-10a5 5 0 0 0 0 10H13" /></>);
export const MousePointer2 = icon('MousePointer2', <path d="M5.2 4.3l13.3 5.5a.6.6 0 0 1 0 1.1l-5.6 2-2 5.6a.6.6 0 0 1-1.1 0L4.3 5.2a.7.7 0 0 1 .9-.9z" />);
export const SlidersHorizontal = icon('SlidersHorizontal', <><path d="M4 7h8.5M16.5 7H20M4 17h3.5M11.5 17H20" /><circle cx="14.5" cy="7" r="2" /><circle cx="9.5" cy="17" r="2" /></>);
export const ZoomIn = icon('ZoomIn', <><circle className="tone" cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L20 20M10.5 8v5M8 10.5h5" /></>);
export const ZoomOut = icon('ZoomOut', <><circle className="tone" cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L20 20M8 10.5h5" /></>);
export const Search = icon('Search', <><circle className="tone" cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L20 20" /></>);
export const Shuffle = icon('Shuffle', <><path d="M3.5 7h3c1.9 0 3 .9 4.1 2.6l2.8 4.8c1.1 1.7 2.2 2.6 4.1 2.6h3" /><path d="M3.5 17h3c1.1 0 2-.3 2.7-.9M14.8 7.9c.7-.6 1.6-.9 2.7-.9h3" /><path d="M18 4l2.5 3L18 10M18 14l2.5 3-2.5 3" /></>);
export const ArrowLeftRight = icon('ArrowLeftRight', <><path d="M4 8h15.5M16 4.5L19.5 8 16 11.5" /><path d="M20 16H4.5M8 12.5L4.5 16 8 19.5" /></>);
export const ArrowUp = icon('ArrowUp', <path d="M12 19.5v-15M6.5 10L12 4.5 17.5 10" />);
export const ChevronDown = icon('ChevronDown', <path d="M6.5 9.5L12 15l5.5-5.5" />);
export const ChevronUp = icon('ChevronUp', <path d="M6.5 14.5L12 9l5.5 5.5" />);
export const Ellipsis = icon('Ellipsis', <>{dot(6, 12, 1.5)}{dot(12, 12, 1.5)}{dot(18, 12, 1.5)}</>);

// Panels, files, and places
export const PanelLeft = icon('PanelLeft', <><rect className="tone" x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>);
export const PanelRight = icon('PanelRight', <><rect className="tone" x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16" /></>);
export const Settings = icon('Settings', <><path className="tone" d={cog} /><circle cx="12" cy="12" r="2.8" /></>);
export const FolderOpen = icon('FolderOpen', <><path d="M3.5 17.5V6a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L12 6h5.5a2 2 0 0 1 2 2v2" /><path className="tone" d="M3.5 17.5l2.3-6.2a2 2 0 0 1 1.9-1.3H20a1 1 0 0 1 1 1.3l-2.2 6.6a2 2 0 0 1-1.9 1.4H5.4a1.9 1.9 0 0 1-1.9-1.8z" /></>);
export const Download = icon('Download', <path d="M12 3.5V15M7 10l5 5 5-5M4.5 20h15" />);
export const Upload = icon('Upload', <path d="M12 15V3.5M7 8.5l5-5 5 5M4.5 20h15" />);
export const Archive = icon('Archive', <><rect className="tone" x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" /><path d="M10 13h4" /></>);
export const Bookmark = icon('Bookmark', <path className="tone" d="M6 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v15.5a.5.5 0 0 1-.8.4L12 17l-5.2 3.9a.5.5 0 0 1-.8-.4z" />);
export const Library = icon('Library', <><path d="M5 4v16M9 4v16" /><path className="tone" d="M13.2 5.3l3.9-1.1a1 1 0 0 1 1.2.7l3.4 13.5a1 1 0 0 1-.7 1.2l-3.9 1a1 1 0 0 1-1.2-.7L12.5 6.5a1 1 0 0 1 .7-1.2z" /></>);
export const Layers = icon('Layers', <><path className="tone" d="M12 3.5l8.5 4.5L12 12.5 3.5 8z" /><path d="M3.5 12l8.5 4.5 8.5-4.5" /><path d="M3.5 16l8.5 4.5 8.5-4.5" /></>);
export const Code = icon('Code', <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5" />);
export const FlaskConical = icon('FlaskConical', <><path className="tone" d="M9 3.5h6M10 3.5v5.8L4.7 18.5A1.7 1.7 0 0 0 6.2 21h11.6a1.7 1.7 0 0 0 1.5-2.5L14 9.3V3.5" /><path d="M7 15h10" /></>);
export const Globe = icon('Globe', <><circle className="tone" cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.4 2.5 3.5 5.5 3.5 9s-1.1 6.5-3.5 9c-2.4-2.5-3.5-5.5-3.5-9S9.6 5.5 12 3z" /></>);
export const ExternalLink = icon('ExternalLink', <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>);
export const Cloud = icon('Cloud', <path className="tone" d="M7 18.5h10.5a3.75 3.75 0 0 0 .4-7.5A5.75 5.75 0 0 0 7 9.5a4.5 4.5 0 0 0 0 9z" />);
export const LogIn = icon('LogIn', <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M4 12h11M11 8l4 4-4 4" /></>);
export const LogOut = icon('LogOut', <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M9 12h11M16 8l4 4-4 4" /></>);

// Chat and notes
export const AtSign = icon('AtSign', <><circle cx="12" cy="12" r="3.5" /><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7" /></>);
export const Paperclip = icon('Paperclip', <path d="M19.5 11.5l-7.8 7.8a4.9 4.9 0 0 1-7-7l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7L9.4 17a1.6 1.6 0 0 1-2.3-2.3l7.6-7.6" />);
export const MessageSquarePlus = icon('MessageSquarePlus', <><path className="tone" d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H9l-4.2 3.4a.5.5 0 0 1-.8-.4z" /><path d="M12 7.5v6M9 10.5h6" /></>);
export const StickyNote = icon('StickyNote', <><path className="tone" d="M6 4h12a2 2 0 0 1 2 2v8.2a2 2 0 0 1-.6 1.4l-3.8 3.8a2 2 0 0 1-1.4.6H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><path d="M14 20v-4.5a1.5 1.5 0 0 1 1.5-1.5H20" /></>);
export const ListChecks = icon('ListChecks', <><path d="M3.5 6.5L5.2 8 8.5 4.8M3.5 15.5L5.2 17l3.3-3.2" /><path d="M12 7h8.5M12 16h8.5" /></>);
export const Brain = icon('Brain', <><path className="tone" d="M12 5c-.9-1.6-3.9-1.8-4.9.3-2.2-.2-3.6 1.9-2.8 3.8-1.6 1-1.6 3.6 0 4.6-.8 1.9.6 4 2.8 3.8 1 2.1 4 1.9 4.9.3z" /><path className="tone" d="M12 5c.9-1.6 3.9-1.8 4.9.3 2.2-.2 3.6 1.9 2.8 3.8 1.6 1 1.6 3.6 0 4.6.8 1.9-.6 4-2.8 3.8-1 2.1-4 1.9-4.9.3z" /><path d="M12 5v12.8M8.5 9.5c1.2.1 1.8.9 1.8 2M15.5 9.5c-1.2.1-1.8.9-1.8 2" /></>);
export const Eye = icon('Eye', <><path d="M2.5 12C5 7.6 8.2 5.5 12 5.5s7 2.1 9.5 6.5c-2.5 4.4-5.7 6.5-9.5 6.5S5 16.4 2.5 12z" /><circle className="tone" cx="12" cy="12" r="3" /></>);
export const Dices = icon('Dices', <><rect className="tone" x="4" y="4" width="16" height="16" rx="4" />{dot(8.5, 8.5, 1.4)}{dot(12, 12, 1.4)}{dot(15.5, 15.5, 1.4)}</>);

// Status
export const CircleAlert = icon('CircleAlert', <><circle className="tone" cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" />{dot(12, 16.5)}</>);
export const TriangleAlert = icon('TriangleAlert', <><path className="tone" d="M10.3 4.4a2 2 0 0 1 3.4 0l7.4 12.7a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z" /><path d="M12 9.5v4" />{dot(12, 16.8)}</>);
export const CircleQuestionMark = icon('CircleQuestionMark', <><circle className="tone" cx="12" cy="12" r="9" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.4v.3" />{dot(12, 16.8)}</>);
export const LoaderCircle = icon('LoaderCircle', <path d="M20.5 12a8.5 8.5 0 1 1-5.8-8.1" />);
export const Power = icon('Power', <><path d="M12 3.5v7.5" /><path d="M6.7 6.7a7.5 7.5 0 1 0 10.6 0" /></>);
export const Wrench = icon('Wrench', <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.4-3.4a6 6 0 0 1-7.9 7.9l-6.3 6.3a2.1 2.1 0 0 1-3-3l6.3-6.3a6 6 0 0 1 7.9-7.9z" />);

/** Every icon by name, for the contact sheet and tests. */
export const ALL_ICONS = {
  Archive, ArrowLeftRight, ArrowUp, AtSign, AudioLines, Bookmark, Brain, Check, ChevronDown, ChevronUp, CircleAlert, CircleQuestionMark, CircleStop,
  ClipboardPaste, Cloud, Code, Copy, CopyPlus, Dices, Download, Drum, Ear, Ellipsis, ExternalLink, Eye, FlaskConical, FolderOpen, Gauge, Globe, Layers,
  Library, ListChecks, LoaderCircle, LogIn, LogOut, MessageSquarePlus, Metronome, Mic, MousePointer2, Music, PanelLeft, PanelRight, Paperclip, Pause,
  Pencil, Piano, Play, Plus, Power, Redo2, Repeat, RotateCcw, Scissors, Search, Settings, Shuffle, SkipBack, SlidersHorizontal, Square, StickyNote,
  Trash, TriangleAlert, Undo2, Upload, Wrench, X, ZoomIn, ZoomOut,
};
