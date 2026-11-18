import { useCallback, useMemo, useRef, useState } from 'react';
import { anyToPdf, isPdfFile } from '../studio/importAny';
import { BLANK_SRC, ensurePdfName, materialize, nextKey, registerSource, releaseSource, type VirtualPage } from './engine';

export interface WorkDoc {
  id: string;
  name: string;
  pages: VirtualPage[];
  past: VirtualPage[][];
  future: VirtualPage[][];
  /** original byte size, for display */
  size: number;
  /** last engine tool applied, for display */
  lastTool?: string;
}

const MAX_HISTORY = 60;

const withHistory = (d: WorkDoc, pages: VirtualPage[]): WorkDoc => ({
  ...d,
  pages,
  past: [...d.past.slice(-MAX_HISTORY + 1), d.pages],
  future: []
});

const sourcesOf = (d: WorkDoc) => {
  const all = [d.pages, ...d.past, ...d.future].flat();
  return new Set(all.map((p) => p.src).filter((s) => s !== BLANK_SRC));
};

export const useWorkspace = () => {
  const [docs, setDocs] = useState<WorkDoc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const anchor = useRef<string | null>(null);

  const active = useMemo(() => docs.find((d) => d.id === activeId) ?? null, [docs, activeId]);

  const patchActive = useCallback(
    (fn: (d: WorkDoc) => WorkDoc) => {
      if (!activeId) return;
      setDocs((prev) => prev.map((d) => (d.id === activeId ? fn(d) : d)));
    },
    [activeId]
  );

  const edit = useCallback((fn: (pages: VirtualPage[]) => VirtualPage[]) => patchActive((d) => withHistory(d, fn(d.pages))), [patchActive]);

  // ---------------------------------------------------------------- documents

  const openFile = useCallback(async (file: File, opts?: { activate?: boolean; lastTool?: string }): Promise<WorkDoc | null> => {
    let pdf = file;
    if (!isPdfFile(file)) {
      const r = await anyToPdf([file]);
      pdf = r.pdf;
    }
    const { pages } = await registerSource(pdf);
    const doc: WorkDoc = { id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: ensurePdfName(pdf.name), pages, past: [], future: [], size: pdf.size, lastTool: opts?.lastTool };
    setDocs((prev) => [...prev, doc]);
    if (opts?.activate !== false) {
      setActiveId(doc.id);
      setSelection(new Set());
    }
    return doc;
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return { ok: 0, failed: [] as string[] };
      setImporting(true);
      const failed: string[] = [];
      let ok = 0;
      try {
        for (let i = 0; i < files.length; i++) {
          try {
            await openFile(files[i], { activate: i === 0 });
            ok++;
          } catch (e) {
            console.error('[studio] falha ao abrir', files[i].name, e);
            failed.push(files[i].name);
          }
        }
      } finally {
        setImporting(false);
      }
      return { ok, failed };
    },
    [openFile]
  );

  const closeDoc = useCallback(
    (id: string) => {
      setDocs((prev) => {
        const target = prev.find((d) => d.id === id);
        const rest = prev.filter((d) => d.id !== id);
        if (target) {
          const stillUsed = new Set(rest.flatMap((d) => Array.from(sourcesOf(d))));
          for (const s of sourcesOf(target)) if (!stillUsed.has(s)) releaseSource(s);
        }
        return rest;
      });
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const others = docs.filter((d) => d.id !== id);
        return others[0]?.id ?? null;
      });
      setSelection(new Set());
    },
    [docs]
  );

  const renameDoc = useCallback((id: string, name: string) => setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, name: ensurePdfName(name.trim() || d.name) } : d))), []);

  const activate = useCallback((id: string) => {
    setActiveId(id);
    setSelection(new Set());
  }, []);

  /** Replaces the active document's content with a new PDF (e.g. an engine result). */
  const replaceActive = useCallback(
    async (file: File, lastTool?: string) => {
      const { pages } = await registerSource(file);
      patchActive((d) => ({ ...withHistory(d, pages), size: file.size, lastTool, name: d.name }));
      setSelection(new Set());
    },
    [patchActive]
  );

  /** Appends every page of `otherId` to the active document (client-side merge). */
  const appendDoc = useCallback(
    (otherId: string) => {
      const other = docs.find((d) => d.id === otherId);
      if (!other || other.id === activeId) return;
      edit((pages) => [...pages, ...other.pages.map((p) => ({ ...p, key: nextKey(), breakAfter: false }))]);
    },
    [docs, activeId, edit]
  );

  /** Merges every open document into the active one, in list order. */
  const mergeAll = useCallback(() => {
    if (!active) return;
    const others = docs.filter((d) => d.id !== active.id);
    if (!others.length) return;
    edit((pages) => [...pages, ...others.flatMap((o) => o.pages.map((p) => ({ ...p, key: nextKey(), breakAfter: false })))]);
  }, [active, docs, edit]);

  // ---------------------------------------------------------------- selection

  const targets = useCallback(
    (keys?: string[]) => {
      if (keys?.length) return new Set(keys);
      return selection;
    },
    [selection]
  );

  const select = useCallback(
    (key: string, mode: 'single' | 'toggle' | 'range', order: string[]) => {
      setSelection((prev) => {
        if (mode === 'single') {
          anchor.current = key;
          return new Set([key]);
        }
        if (mode === 'toggle') {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          anchor.current = key;
          return next;
        }
        const a = order.indexOf(anchor.current ?? key);
        const b = order.indexOf(key);
        if (a < 0 || b < 0) return new Set([key]);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        return new Set([...prev, ...order.slice(lo, hi + 1)]);
      });
    },
    []
  );

  const selectAll = useCallback(() => {
    if (active) setSelection(new Set(active.pages.map((p) => p.key)));
  }, [active]);

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  const selectByPredicate = useCallback(
    (fn: (page: VirtualPage, i: number) => boolean) => {
      if (active) setSelection(new Set(active.pages.filter(fn).map((p) => p.key)));
    },
    [active]
  );

  // ---------------------------------------------------------------- page ops

  const rotate = useCallback(
    (delta: number, keys?: string[]) => {
      const t = targets(keys);
      if (!t.size) return;
      edit((pages) => pages.map((p) => (t.has(p.key) ? { ...p, rotation: (((p.rotation + delta) % 360) + 360) % 360 } : p)));
    },
    [edit, targets]
  );

  const remove = useCallback(
    (keys?: string[]) => {
      const t = targets(keys);
      if (!t.size) return;
      edit((pages) => (pages.length > t.size ? pages.filter((p) => !t.has(p.key)) : pages));
      setSelection(new Set());
    },
    [edit, targets]
  );

  const duplicate = useCallback(
    (keys?: string[]) => {
      const t = targets(keys);
      if (!t.size) return;
      const created: string[] = [];
      edit((pages) =>
        pages.flatMap((p) => {
          if (!t.has(p.key)) return [p];
          const copy = { ...p, key: nextKey(), breakAfter: false };
          created.push(copy.key);
          return [p, copy];
        })
      );
      setSelection(new Set(created));
    },
    [edit, targets]
  );

  const insertBlank = useCallback(
    (afterKey?: string | null) => {
      const blank: VirtualPage = { key: nextKey(), src: BLANK_SRC, index: 0, rotation: 0 };
      edit((pages) => {
        if (afterKey === null) return [blank, ...pages];
        const i = afterKey ? pages.findIndex((p) => p.key === afterKey) : pages.length - 1;
        const next = [...pages];
        next.splice(i + 1, 0, blank);
        return next;
      });
      setSelection(new Set([blank.key]));
    },
    [edit]
  );

  const move = useCallback(
    (fromKey: string, toKey: string) => {
      if (fromKey === toKey) return;
      edit((pages) => {
        const from = pages.findIndex((p) => p.key === fromKey);
        const to = pages.findIndex((p) => p.key === toKey);
        if (from < 0 || to < 0) return pages;
        const moving = selection.has(fromKey) ? pages.filter((p) => selection.has(p.key)) : [pages[from]];
        const movingKeys = new Set(moving.map((p) => p.key));
        const rest = pages.filter((p) => !movingKeys.has(p.key));
        let insertAt = rest.findIndex((p) => p.key === toKey);
        if (insertAt < 0) insertAt = rest.length;
        if (from < to) insertAt += 1;
        rest.splice(insertAt, 0, ...moving);
        return rest;
      });
    },
    [edit, selection]
  );

  const reverse = useCallback(() => edit((pages) => [...pages].reverse()), [edit]);

  const toggleBreak = useCallback(
    (keys?: string[]) => {
      const t = targets(keys);
      if (!t.size) return;
      edit((pages) => {
        const allOn = pages.filter((p) => t.has(p.key)).every((p) => p.breakAfter);
        return pages.map((p) => (t.has(p.key) ? { ...p, breakAfter: !allOn } : p));
      });
    },
    [edit, targets]
  );

  const clearBreaks = useCallback(() => edit((pages) => pages.map((p) => (p.breakAfter ? { ...p, breakAfter: false } : p))), [edit]);

  /** Every N pages, put a split marker. */
  const breakEvery = useCallback((n: number) => edit((pages) => pages.map((p, i) => ({ ...p, breakAfter: (i + 1) % n === 0 && i < pages.length - 1 }))), [edit]);

  /** Moves the selected pages into a new document. */
  const extractSelection = useCallback(
    (keepInSource: boolean) => {
      if (!active || !selection.size) return;
      const picked = active.pages.filter((p) => selection.has(p.key)).map((p) => ({ ...p, key: nextKey(), breakAfter: false }));
      const doc: WorkDoc = { id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: ensurePdfName(active.name.replace(/\.pdf$/i, '') + ' (páginas)'), pages: picked, past: [], future: [], size: 0 };
      setDocs((prev) => {
        const next = prev.map((d) => (d.id === active.id && !keepInSource && d.pages.length > selection.size ? withHistory(d, d.pages.filter((p) => !selection.has(p.key))) : d));
        return [...next, doc];
      });
      setActiveId(doc.id);
      setSelection(new Set());
    },
    [active, selection]
  );

  // ---------------------------------------------------------------- undo / redo

  const undo = useCallback(() => {
    patchActive((d) => {
      const prev = d.past[d.past.length - 1];
      if (!prev) return d;
      return { ...d, pages: prev, past: d.past.slice(0, -1), future: [d.pages, ...d.future] };
    });
    setSelection(new Set());
  }, [patchActive]);

  const redo = useCallback(() => {
    patchActive((d) => {
      const next = d.future[0];
      if (!next) return d;
      return { ...d, pages: next, past: [...d.past, d.pages], future: d.future.slice(1) };
    });
    setSelection(new Set());
  }, [patchActive]);

  // ---------------------------------------------------------------- output

  const materializeActive = useCallback(async (): Promise<File | null> => {
    if (!active) return null;
    return materialize(active.pages, active.name);
  }, [active]);

  return {
    docs,
    active,
    activeId,
    selection,
    importing,
    canUndo: Boolean(active?.past.length),
    canRedo: Boolean(active?.future.length),
    openFile,
    addFiles,
    closeDoc,
    renameDoc,
    activate,
    replaceActive,
    appendDoc,
    mergeAll,
    select,
    selectAll,
    clearSelection,
    selectByPredicate,
    rotate,
    remove,
    duplicate,
    insertBlank,
    move,
    reverse,
    toggleBreak,
    clearBreaks,
    breakEvery,
    extractSelection,
    undo,
    redo,
    materializeActive
  };
};

export type Workspace = ReturnType<typeof useWorkspace>;
