/**
 * Editor visual de divisão.
 *
 * Digitar "cortar depois da página 3" só funciona quando já se sabe o que tem na página 3. Numa
 * pilha de contratos digitalizados não se sabe — por isso aqui o documento aparece inteiro, em
 * miniaturas agrupadas pelo arquivo em que cada página vai cair: o usuário lê a página, clica em
 * "cortar aqui" e o agrupamento se refaz na hora. O plano (`SplitSegment[]`) é aplicado localmente
 * com pdf-lib, então o ZIP sai exatamente igual ao que apareceu na tela.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookMarked, ChevronLeft, ChevronRight, Eraser, Eye, FileText, Layers, Loader2, Scissors, SearchCode, Sparkles, Split, Undo2, X } from 'lucide-react';
import { Button, Input, Switch, cn } from '../../../components/ui';
import { PDFLib } from '../../../utils/pdfWorker';
import { matchTextStarts, pageTexts, partFileName, rangeLabel, segmentsFromCuts, type SplitSegment } from '../splitPlan';

/** Estado cru do editor. Guardado pelo card da ferramenta para reabrir exatamente onde parou. */
export interface SplitDraft {
  cuts: number[];
  names: Record<number, string>;
  dropped: number[];
}

interface Props {
  file: File;
  onClose: () => void;
  onApply: (segments: SplitSegment[]) => void;
  /** espelha o plano atual (e o estado cru) para o card mostrar o preview e poder reabrir igual */
  onPlanChange?: (segments: SplitSegment[], draft: SplitDraft) => void;
  /** estado de uma sessão anterior deste mesmo arquivo */
  initialDraft?: SplitDraft | null;
}

const THUMB_W = 128;
/** Uma cor por documento, em ciclo: é o que deixa óbvio onde um arquivo termina e o outro começa. */
const TINTS = [
  { ring: 'ring-brand-500', chip: 'bg-brand-50 text-brand-700 border-brand-200', bar: 'bg-brand-500', soft: 'bg-brand-50/40' },
  { ring: 'ring-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500', soft: 'bg-emerald-50/40' },
  { ring: 'ring-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-500', soft: 'bg-amber-50/40' },
  { ring: 'ring-sky-500', chip: 'bg-sky-50 text-sky-700 border-sky-200', bar: 'bg-sky-500', soft: 'bg-sky-50/40' },
  { ring: 'ring-violet-500', chip: 'bg-violet-50 text-violet-700 border-violet-200', bar: 'bg-violet-500', soft: 'bg-violet-50/40' },
  { ring: 'ring-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200', bar: 'bg-rose-500', soft: 'bg-rose-50/40' }
];

type PdfDoc = Awaited<ReturnType<typeof PDFLib.getDocument>['promise']>;

const SplitStudio = ({ file, onClose, onApply, onPlanChange, initialDraft }: Props) => {
  const docRef = useRef<PdfDoc | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [docReady, setDocReady] = useState(0);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [rendered, setRendered] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** páginas depois das quais o documento é cortado */
  const [cuts, setCuts] = useState<Set<number>>(() => new Set(initialDraft?.cuts ?? []));
  /** nome escolhido para cada bloco, indexado pela primeira página dele */
  const [names, setNames] = useState<Record<number, string>>(() => ({ ...(initialDraft?.names ?? {}) }));
  /** blocos que o usuário decidiu não gerar */
  const [dropped, setDropped] = useState<Set<number>>(() => new Set(initialDraft?.dropped ?? []));

  const [focus, setFocus] = useState(1);
  const [preview, setPreview] = useState<string | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [everyN, setEveryN] = useState('1');
  const [marker, setMarker] = useState('');
  const [busy, setBusy] = useState<'text' | 'chapters' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // documento
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await file.arrayBuffer();
      const doc = await PDFLib.getDocument({ data }).promise;
      if (cancelled) {
        void doc.destroy();
        return;
      }
      docRef.current = doc;
      setNumPages(doc.numPages);
      setDocReady((n) => n + 1);
    })().catch(() => setLoadError('Não foi possível abrir este PDF. Ele pode estar protegido por senha ou corrompido.'));
    return () => {
      cancelled = true;
      void docRef.current?.destroy();
      docRef.current = null;
    };
  }, [file]);

  // miniaturas, em sequência (a primeira aparece rápido, o resto vai chegando)
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || docReady <= 0) return;
    let cancelled = false;
    (async () => {
      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled) return;
        try {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (THUMB_W / base.width) * Math.min(2, window.devicePixelRatio || 1) });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
          if (cancelled) return;
          const url = canvas.toDataURL('image/jpeg', 0.7);
          setThumbs((t) => ({ ...t, [n]: url }));
          setRendered(n);
        } catch {
          /* página inválida: segue para a próxima */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docReady]);

  // página em destaque, em resolução de leitura
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || docReady <= 0 || focus < 1) return;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(Math.min(focus, doc.numPages));
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (760 / base.width) * Math.min(2, window.devicePixelRatio || 1) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
      if (!cancelled) setPreview(canvas.toDataURL('image/jpeg', 0.85));
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [focus, docReady]);

  const baseName = useMemo(() => file.name.replace(/\.pdf$/i, ''), [file.name]);

  const segments = useMemo(() => {
    const list = segmentsFromCuts(numPages, cuts);
    return list.map((s) => ({ ...s, name: names[s.from] ?? s.name, keep: !dropped.has(s.from) }));
  }, [numPages, cuts, names, dropped]);

  // mantém o card da ferramenta em sincronia com o que está na tela
  useEffect(() => {
    if (!numPages) return; // ainda abrindo o PDF: não apaga o preview do card
    onPlanChange?.(segments, { cuts: [...cuts], names, dropped: [...dropped] });
    // onPlanChange é estável no chamador; incluí-lo aqui reexecutaria a cada render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments]);

  const kept = segments.filter((s) => s.keep);
  const keptPages = kept.reduce((n, s) => n + (s.to - s.from + 1), 0);
  const docOfPage = (page: number) => segments.findIndex((s) => page >= s.from && page <= s.to);

  const toggleCut = useCallback((afterPage: number) => {
    setCuts((prev) => {
      const next = new Set(prev);
      if (next.has(afterPage)) next.delete(afterPage);
      else next.add(afterPage);
      return next;
    });
    setNotice(null);
  }, []);

  const applyPlan = (nextCuts: Set<number>, nextNames: Record<number, string> = {}) => {
    setCuts(nextCuts);
    setNames(nextNames);
    setDropped(new Set());
  };

  const splitEvery = (n: number) => {
    const step = Math.max(1, Math.floor(n) || 1);
    const next = new Set<number>();
    for (let p = step; p < numPages; p += step) next.add(p);
    applyPlan(next);
    setNotice(null);
  };

  const openPage = (p: number) => {
    setFocus(p);
    if (window.innerWidth < 768) setReaderOpen(true);
  };

  /** transforma "páginas onde um documento começa" em cortes + nomes */
  const applyStarts = (starts: { page: number; label?: string }[]) => {
    const next = new Set<number>();
    const labels: Record<number, string> = {};
    starts.forEach((s, i) => {
      const from = i === 0 ? 1 : s.page;
      if (i > 0) next.add(s.page - 1);
      if (s.label) labels[from] = s.label;
    });
    applyPlan(next, labels);
    setNotice({ tone: 'ok', text: `${starts.length} documento(s) encontrados. Confira os cortes e ajuste o que precisar antes de gerar.` });
  };

  const detectByText = async () => {
    if (!marker.trim() || busy) return;
    setBusy('text');
    setNotice(null);
    try {
      applyStarts(matchTextStarts(await pageTexts(file), marker));
    } catch (e) {
      setNotice({ tone: 'warn', text: e instanceof Error ? e.message : 'Não foi possível detectar.' });
    } finally {
      setBusy(null);
    }
  };

  const detectChapters = async () => {
    const doc = docRef.current;
    if (!doc || busy) return;
    setBusy('chapters');
    setNotice(null);
    try {
      const outline = await doc.getOutline();
      const found: { page: number; label: string }[] = [];
      for (const item of outline ?? []) {
        const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
        const ref = Array.isArray(dest) ? dest[0] : null;
        if (!ref) continue;
        const idx = await doc.getPageIndex(ref as Parameters<typeof doc.getPageIndex>[0]);
        found.push({ page: idx + 1, label: String(item.title ?? '').trim() });
      }
      const starts = found
        .sort((a, b) => a.page - b.page)
        .filter((s, i, arr) => i === 0 || s.page !== arr[i - 1].page);
      if (starts.length < 2) {
        setNotice({ tone: 'warn', text: 'Este PDF não tem marcadores de capítulo suficientes. Use a detecção por texto ou marque os cortes à mão.' });
        return;
      }
      applyStarts(starts);
    } catch {
      setNotice({ tone: 'warn', text: 'Não foi possível ler os marcadores deste PDF.' });
    } finally {
      setBusy(null);
    }
  };

  // atalhos: setas navegam, S corta antes da página em foco
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (readerOpen) setReaderOpen(false);
        else onClose();
      } else if (e.key === 'ArrowRight') setFocus((p) => Math.min(numPages, p + 1));
      else if (e.key === 'ArrowLeft') setFocus((p) => Math.max(1, p - 1));
      else if (e.key.toLowerCase() === 's' && focus > 1) toggleCut(focus - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numPages, focus, onClose, toggleCut, readerOpen]);

  // mantém a página em foco visível na grade
  useEffect(() => {
    gridRef.current?.querySelector(`[data-page="${focus}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  const loading = !numPages && !loadError;

  return createPortal(
    <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4 lg:p-6" onMouseDown={onClose}>
      <div
        className="bg-white w-full max-w-[1360px] h-[100dvh] sm:h-[94vh] sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Dividir PDF visualmente"
      >
        {/* Cabeçalho */}
        <div className="shrink-0 flex items-start justify-between gap-3 px-4 sm:px-5 py-3 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight truncate">Dividir PDF</h2>
            <p className="text-[11px] sm:text-xs text-slate-500 truncate">
              {loading ? 'Abrindo documento…' : `${file.name} · ${numPages} páginas`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="h-9 w-9 rounded-xl hover:bg-slate-100 text-slate-500 flex items-center justify-center shrink-0" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Como usar + ações rápidas */}
        <div className="shrink-0 border-b border-slate-100 bg-slate-50/70">
          <p className="px-4 sm:px-5 pt-2.5 text-[11px] sm:text-xs text-slate-600">
            Clique numa página para <strong>lê-la</strong> e use a <strong className="text-brand-700">tesoura entre as páginas</strong> para começar um arquivo novo ali. Cada cor é um arquivo.
          </p>
          <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 py-2.5">
            <Button size="sm" variant="outline" onClick={() => splitEvery(1)} disabled={!numPages}>
              <Split className="w-3.5 h-3.5 mr-1.5" />
              1 página por arquivo
            </Button>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 whitespace-nowrap">A cada</span>
              <div className="w-14">
                <Input value={everyN} onChange={(e) => setEveryN(e.target.value.replace(/\D/g, ''))} className="h-8 text-center px-1" inputMode="numeric" aria-label="Páginas por arquivo" />
              </div>
              <Button size="sm" variant="outline" onClick={() => splitEvery(Number(everyN) || 1)} disabled={!numPages}>
                páginas
              </Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => void detectChapters()} disabled={!numPages || !!busy}>
              {busy === 'chapters' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <BookMarked className="w-3.5 h-3.5 mr-1.5" />}
              Capítulos
            </Button>
            <div className="flex items-center gap-1.5 flex-1 min-w-[220px] [&>div:first-child]:flex-1">
              <Input
                value={marker}
                onChange={(e) => setMarker(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void detectByText();
                }}
                placeholder="Texto que inicia cada documento (ex.: CONTRATO Nº)"
                className="h-8"
                aria-label="Texto que inicia cada documento"
              />
              <Button size="sm" variant="outline" onClick={() => void detectByText()} disabled={!marker.trim() || !!busy}>
                {busy === 'text' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SearchCode className="w-3.5 h-3.5" />}
                <span className="ml-1.5 hidden sm:inline">Detectar</span>
              </Button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => applyPlan(new Set())} disabled={!cuts.size}>
              <Eraser className="w-3.5 h-3.5 mr-1.5" />
              Limpar cortes
            </Button>
          </div>
          {notice && (
            <p className={cn('px-4 sm:px-5 py-2 text-xs border-t', notice.tone === 'ok' ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-amber-700 bg-amber-50 border-amber-100')}>{notice.text}</p>
          )}
        </div>

        {/* Corpo */}
        <div className="flex-1 min-h-0 md:grid md:grid-cols-[1fr_340px] lg:grid-cols-[1fr_380px] relative">
          {/* Grade agrupada por documento */}
          <div ref={gridRef} className="h-full min-h-0 overflow-auto custom-scrollbar px-3 sm:px-4 py-4">
            {loadError && <p className="text-sm text-rose-600">{loadError}</p>}
            {loading && (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Abrindo documento…
              </div>
            )}
            {segments.map((seg, si) => {
              const tint = TINTS[si % TINTS.length];
              const pages = Array.from({ length: seg.to - seg.from + 1 }, (_, k) => seg.from + k);
              return (
                <div key={seg.from}>
                  {/* Marca de corte entre documentos — visível e reversível */}
                  {si > 0 && (
                    <div className="my-4 rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/70 px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-800 whitespace-nowrap">
                        <span className="grid place-items-center h-6 w-6 rounded-full bg-brand-600 text-white shadow-sm">
                          <Scissors className="w-3.5 h-3.5" />
                        </span>
                        Corte na página {seg.from}
                      </span>
                      <span className="hidden sm:block flex-1 min-w-[16px] border-t-2 border-dashed border-brand-300" />
                      <button
                        type="button"
                        onClick={() => toggleCut(seg.from - 1)}
                        className="ml-auto inline-flex items-center gap-2 h-9 px-3.5 rounded-xl bg-white text-slate-800 text-xs font-bold border-2 border-slate-300 shadow-sm hover:bg-slate-900 hover:text-white hover:border-slate-900 active:scale-[0.98] transition-all"
                        title={`Remover este corte e juntar o Documento ${si + 1} de volta ao Documento ${si}`}
                      >
                        <Undo2 className="w-4 h-4" />
                        Remover corte
                        <span className="font-medium opacity-80">· junta com o Documento {si}</span>
                      </button>
                    </div>
                  )}

                  <section className={cn('rounded-xl border overflow-hidden', seg.keep ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50 opacity-70')}>
                    <header className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-100 bg-white/90 sticky top-0 z-[1]">
                      <span className={cn('h-6 w-1.5 rounded-full shrink-0', tint.bar)} />
                      <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap', tint.chip)}>Documento {si + 1}</span>
                      <div className="flex-1 min-w-[140px]">
                        <Input
                          value={names[seg.from] ?? ''}
                          onChange={(e) => setNames((p) => ({ ...p, [seg.from]: e.target.value }))}
                          placeholder={`Nome do documento (padrão: ${baseName})`}
                          className="h-8 text-xs"
                          aria-label={`Nome do documento ${si + 1}`}
                        />
                      </div>
                      <span className="text-[11px] tabular-nums text-slate-500 whitespace-nowrap">
                        {rangeLabel(seg)} · {pages.length} pág.
                      </span>
                      {seg.keep !== false && (
                        <span
                          className="basis-full sm:basis-auto order-last sm:order-none text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2 py-0.5 truncate max-w-full"
                          title="Nome deste arquivo dentro do ZIP"
                        >
                          {partFileName(seg, kept.findIndex((k) => k.from === seg.from), kept.length, baseName)}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Switch
                          checked={seg.keep !== false}
                          onChange={(on) =>
                            setDropped((prev) => {
                              const next = new Set(prev);
                              if (on) next.delete(seg.from);
                              else next.add(seg.from);
                              return next;
                            })
                          }
                        />
                        <span className={cn('text-[11px] whitespace-nowrap', seg.keep ? 'text-slate-500' : 'text-amber-600 font-semibold')}>{seg.keep ? 'Gerar' : 'Descartar'}</span>
                      </div>
                    </header>

                    <div className={cn('p-3 flex flex-wrap items-stretch gap-y-3', tint.soft)}>
                      {pages.map((p, i) => (
                        <div key={p} className="flex items-stretch">
                          {/* Espaço de corte entre duas páginas do mesmo documento */}
                          {i > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleCut(p - 1)}
                              className="group/cut relative w-7 sm:w-8 shrink-0 flex flex-col items-center justify-center rounded-lg hover:bg-white/80 transition-colors"
                              title={`Cortar aqui — a página ${p} inicia um arquivo novo`}
                              aria-label={`Cortar antes da página ${p}`}
                            >
                              <span className="absolute inset-y-2 w-0.5 rounded bg-slate-200 group-hover/cut:bg-brand-400 group-focus-visible/cut:bg-brand-400 transition-colors" />
                              <span className="relative h-7 w-7 rounded-full bg-white border border-slate-200 text-slate-400 shadow-sm flex items-center justify-center transition-all group-hover/cut:border-brand-500 group-hover/cut:text-white group-hover/cut:bg-brand-600 group-hover/cut:scale-110">
                                <Scissors className="w-3.5 h-3.5" />
                              </span>
                              <span className="pointer-events-none absolute -bottom-0.5 text-[9px] font-semibold text-brand-700 opacity-0 group-hover/cut:opacity-100 transition-opacity hidden sm:block">cortar</span>
                            </button>
                          )}
                          <div data-page={p} className="relative">
                            <button
                              type="button"
                              onClick={() => openPage(p)}
                              className={cn(
                                'block rounded-lg overflow-hidden bg-white ring-2 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
                                focus === p ? tint.ring : 'ring-slate-200/70 hover:ring-slate-300'
                              )}
                              style={{ width: THUMB_W }}
                              title={`Página ${p} — clique para ler`}
                            >
                              {thumbs[p] ? (
                                <img src={thumbs[p]} alt={`Página ${p}`} className="w-full block" />
                              ) : (
                                <span className="flex items-center justify-center text-slate-300 bg-slate-50" style={{ width: THUMB_W, height: Math.round(THUMB_W * 1.41) }}>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                </span>
                              )}
                              <span className="absolute bottom-1 left-1 text-[10px] font-semibold tabular-nums bg-slate-900/75 text-white rounded px-1.5 py-0.5">{p}</span>
                              <span className="absolute bottom-1 right-1 md:hidden text-[10px] bg-white/90 text-slate-600 rounded px-1.5 py-0.5 flex items-center gap-1">
                                <Eye className="w-3 h-3" />
                                ler
                              </span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              );
            })}
            {!loading && !loadError && rendered < numPages && (
              <p className="mt-3 text-[11px] text-slate-400 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Carregando miniaturas… {rendered}/{numPages}
              </p>
            )}
          </div>

          {/* Leitura da página (painel fixo no desktop, tela cheia no celular) */}
          <aside
            className={cn(
              'flex-col min-h-0 border-l border-slate-100 bg-slate-50/60 md:flex',
              readerOpen ? 'flex fixed inset-0 z-20 bg-white md:static md:bg-slate-50/60' : 'hidden'
            )}
          >
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 bg-white/80">
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                Página {focus}
                {numPages ? <span className="font-normal tracking-normal text-slate-400 normal-case">de {numPages}</span> : null}
              </span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setFocus((p) => Math.max(1, p - 1))} disabled={focus <= 1} className="h-8 w-8 rounded-lg hover:bg-slate-200 text-slate-500 disabled:opacity-40 flex items-center justify-center" aria-label="Página anterior">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => setFocus((p) => Math.min(numPages, p + 1))} disabled={focus >= numPages} className="h-8 w-8 rounded-lg hover:bg-slate-200 text-slate-500 disabled:opacity-40 flex items-center justify-center" aria-label="Próxima página">
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => setReaderOpen(false)} className="md:hidden h-8 w-8 rounded-lg hover:bg-slate-200 text-slate-500 flex items-center justify-center" aria-label="Voltar para as páginas">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto custom-scrollbar p-3 flex items-start justify-center">
              {preview ? <img src={preview} alt={`Página ${focus}`} className="w-full rounded-lg shadow-sm bg-white" /> : <Loader2 className="w-4 h-4 animate-spin text-slate-300 mt-8" />}
            </div>
            <div className="shrink-0 p-3 border-t border-slate-100 bg-white space-y-2">
              <p className="text-[11px] text-slate-500">
                Esta página vai no{' '}
                <strong className="text-slate-700">Documento {docOfPage(focus) + 1}</strong>
                {names[segments[docOfPage(focus)]?.from ?? 1] ? ` — ${names[segments[docOfPage(focus)].from]}` : ''}.
              </p>
              <Button size="sm" variant={cuts.has(focus - 1) ? 'outline' : 'primary'} className="w-full" disabled={focus <= 1} onClick={() => toggleCut(focus - 1)}>
                {cuts.has(focus - 1) ? <Undo2 className="w-3.5 h-3.5 mr-1.5" /> : <Scissors className="w-3.5 h-3.5 mr-1.5" />}
                {cuts.has(focus - 1) ? 'Remover o corte antes desta página' : 'Começar um arquivo novo aqui'}
              </Button>
              <p className="text-[10px] text-slate-400 text-center hidden md:block">← → mudam de página · S corta antes dela · Esc fecha</p>
            </div>
          </aside>
        </div>

        {/* Rodapé */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-t border-slate-100 bg-white">
          <p className="text-xs text-slate-500 flex items-center gap-1.5 order-1">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <strong className="text-slate-800">{kept.length}</strong> {kept.length === 1 ? 'arquivo' : 'arquivos'} · {keptPages} de {numPages} páginas
            {dropped.size > 0 && <span className="text-amber-600">· {dropped.size} descartado(s)</span>}
          </p>
          <div className="flex items-center gap-2 order-2 w-full sm:w-auto">
            <Button variant="ghost" className="flex-1 sm:flex-none" onClick={onClose}>
              Cancelar
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={() => onApply(segments)} disabled={!kept.length || loading}>
              <Sparkles className="w-4 h-4 mr-1.5" />
              Gerar {kept.length} {kept.length === 1 ? 'arquivo' : 'arquivos'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SplitStudio;
