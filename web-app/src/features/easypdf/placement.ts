/**
 * Posição de um elemento (assinatura, carimbo, imagem) numa página do PDF.
 * Tudo em percentual do tamanho da página, medido a partir do canto inferior esquerdo
 * do elemento — igual à convenção do PDF/pdf-lib.
 */
export interface Placement {
  /** 1-based; 0 = todas as páginas. */
  page: number;
  x: number;
  y: number;
  /** Largura em % da largura da página (elementos de imagem). */
  widthPct: number;
  /** Tamanho da fonte em pontos (elementos de texto). */
  fontSize: number;
  opacity: number;
  /** Graus, anti-horário, em torno do canto inferior esquerdo. */
  rotation: number;
  /** Tamanho em pontos da página usada para posicionar (para converter % → pt). */
  pageW: number;
  pageH: number;
}

export type PlacementOverlay = { kind: 'image'; url: string } | { kind: 'text'; text: string; color: string };

export const DEFAULT_PLACEMENT: Placement = { page: 1, x: 62, y: 10, widthPct: 28, fontSize: 30, opacity: 1, rotation: 0, pageW: 595, pageH: 842 };

/** Converte a posição em % para pontos PDF (origem inferior esquerda). */
export const placementToPoints = (p: Placement) => ({ x: (p.pageW * p.x) / 100, y: (p.pageH * p.y) / 100, width: (p.pageW * p.widthPct) / 100 });

/** Páginas-alvo de uma lista de posições (vazia = todas). */
export const placementPages = (list: Placement[]) => (list.some((p) => p.page === 0) ? [] : [...new Set(list.map((p) => p.page))].sort((a, b) => a - b));

/** Texto curto a descrever onde a lista de posições será aplicada. */
export const describePlacements = (list: Placement[]) => {
  const pages = placementPages(list);
  const extra = list.length > Math.max(1, pages.length) ? ` · ${list.length} assinaturas` : '';
  if (!pages.length) return `Todas as páginas${extra}`;
  if (pages.length === 1) return `Página ${pages[0]}${extra}`;
  return `${pages.length} páginas (${pages.slice(0, 6).join(', ')}${pages.length > 6 ? '…' : ''})${extra}`;
};
