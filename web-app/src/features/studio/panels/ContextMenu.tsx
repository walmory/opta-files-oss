import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../../components/ui';

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
  /** renders a flyout instead of firing onClick */
  items?: MenuItem[];
  /** horizontal rule above this entry */
  separatorBefore?: boolean;
}

const MARGIN = 6;
const WIDTH = 232;

const Row = ({ item, onRun }: { item: MenuItem; onRun: () => void }) => {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const Icon = item.icon;
  const hasSub = Boolean(item.items?.length);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const h = Math.min((item.items?.length || 0) * 30 + 12, window.innerHeight - 2 * MARGIN);
    const left = r.right + WIDTH + MARGIN > window.innerWidth ? r.left - WIDTH : r.right;
    setPos({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, Math.min(r.top - 4, window.innerHeight - h - MARGIN)) });
  }, [open, item.items]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={item.disabled}
        onMouseEnter={() => setOpen(hasSub)}
        onMouseLeave={() => hasSub && setOpen(false)}
        onClick={() => {
          if (hasSub || item.disabled) return;
          item.onClick?.();
          onRun();
        }}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 h-8 text-[13px] text-left rounded-lg transition-colors',
          item.disabled ? 'text-slate-300 cursor-default' : item.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-100'
        )}
      >
        {Icon ? <Icon className="w-4 h-4 shrink-0 opacity-80" /> : <span className="w-4 shrink-0" />}
        <span className="flex-1 truncate">{item.label}</span>
        {item.shortcut && !hasSub && <span className="text-[11px] text-slate-400 tabular-nums">{item.shortcut}</span>}
        {hasSub && <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
      </button>
      {hasSub &&
        open &&
        pos &&
        createPortal(
          <div
            data-studio-overlay="context"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            className="fixed z-[420] p-1.5 rounded-xl border border-slate-200 bg-white shadow-float overflow-y-auto custom-scrollbar"
            style={{ left: pos.left, top: pos.top, width: WIDTH, maxHeight: window.innerHeight - 2 * MARGIN }}
          >
            {item.items?.map((sub) => (
              <div key={sub.id}>
                {sub.separatorBefore && <div className="my-1 h-px bg-slate-100" />}
                <Row item={sub} onRun={onRun} />
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
};

/**
 * Right-click menu rendered in a portal at the cursor. Same reason as Anchored: every studio container
 * clips its overflow, so an absolutely positioned menu would be cut off by the canvas.
 */
const ContextMenu = ({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    // measured once the menu is in the DOM, so it can flip up/left when the cursor is near an edge
    const place = () => {
      const h = ref.current?.offsetHeight ?? 0;
      setPos({
        left: Math.max(MARGIN, Math.min(x, window.innerWidth - WIDTH - MARGIN)),
        top: Math.max(MARGIN, Math.min(y, window.innerHeight - h - MARGIN))
      });
    };
    place();
  }, [x, y, items]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || (t instanceof HTMLElement && t.closest('[data-studio-overlay="context"]'))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      data-studio-overlay="context"
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[400] p-1.5 rounded-xl border border-slate-200 bg-white shadow-float overflow-y-auto custom-scrollbar"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: WIDTH, maxHeight: window.innerHeight - 2 * MARGIN, visibility: pos ? 'visible' : 'hidden' }}
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="my-1 h-px bg-slate-100" />}
          <Row item={item} onRun={onClose} />
        </div>
      ))}
    </div>,
    document.body
  );
};

export default ContextMenu;
