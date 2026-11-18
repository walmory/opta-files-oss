import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../components/ui';

interface Props {
  /** element the panel is positioned against */
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** fixed panel width in px; omit to size from content */
  width?: number;
  /** which edge of the anchor the panel lines up with */
  align?: 'left' | 'right';
  gap?: number;
  className?: string;
  children: React.ReactNode;
}

const MARGIN = 8;

/**
 * Dropdown panel rendered in a portal on <body>.
 *
 * Every container the studio menus live in clips its overflow — the ribbon strip scrolls
 * (`overflow-x-auto`), the properties aside is `overflow-hidden` and the shell root is
 * `overflow-clip` — so an `absolute` panel gets cut off or painted under the canvas no matter
 * how high its z-index is. Portalling escapes the clip; the panel is then positioned with
 * `fixed` coords taken from the anchor, flipping above it when there is no room below.
 */
const Anchored = ({ anchor, open, onClose, width, align = 'left', gap = 4, className, children }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const w = width ?? ref.current?.offsetWidth ?? r.width;
      const h = ref.current?.offsetHeight ?? 0;
      const below = window.innerHeight - r.bottom - gap - MARGIN;
      const above = r.top - gap - MARGIN;
      const flip = h > below && above > below;
      const maxHeight = Math.max(140, flip ? above : below);
      const top = flip ? Math.max(MARGIN, r.top - gap - Math.min(h, maxHeight)) : r.bottom + gap;
      const raw = align === 'right' ? r.right - w : r.left;
      setPos({ left: Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, raw)), top, maxHeight });
    };
    place();
    // re-place once the panel has been measured (height is unknown on the first pass)
    const frame = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, width, gap, anchor]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;

  return createPortal(
    <div
      ref={ref}
      data-studio-overlay="dropdown"
      className={cn('fixed z-[300] overflow-y-auto custom-scrollbar rounded-xl border border-slate-200 bg-white shadow-float', className)}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, maxHeight: pos?.maxHeight, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
};

export default Anchored;
