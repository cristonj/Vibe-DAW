import { useEffect, useState } from 'react';

// App-wide tooltips. Any element with a `title` gets a styled tooltip after a short
// hover (the native one is suppressed), so every control explains itself the same way.
// Write titles as "What it does (Shortcut)"; the shortcut renders as a key chip.

interface Tip { text: string; key?: string; x: number; y: number; above: boolean }

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('[title],[data-tip]') as HTMLElement | null;
      if (el === current) return;
      hide();
      if (!el) return;
      if (el.title) {
        el.dataset.tip = el.title;
        el.removeAttribute('title');
      }
      const raw = el.dataset.tip;
      if (!raw) return;
      current = el;
      timer = setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const m = raw.match(/^(.*?)\s*\(([^()]{1,24})\)$/);
        const above = r.bottom + 44 > window.innerHeight;
        setTip({ text: m ? m[1] : raw, key: m?.[2], x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above });
      }, 450);
    };
    window.addEventListener('pointerover', over);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('wheel', hide, true);
    window.addEventListener('keydown', hide, true);
    return () => {
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('keydown', hide, true);
    };
  }, []);

  if (!tip) return null;
  const left = Math.max(12, Math.min(window.innerWidth - 12, tip.x));
  return (
    <div className="tooltip" role="tooltip" style={{ left, top: tip.y, transform: `translate(-50%, ${tip.above ? '-100%' : '0'})` }}>
      {tip.text}
      {tip.key && <kbd>{tip.key}</kbd>}
    </div>
  );
}
