export type ElementType = 'text' | 'image' | 'checkmark' | 'path' | 'rect' | 'line' | 'circle' | 'arrow';

export interface EditorElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text content, image data URL, or SVG path data */
  content: string;
  // text
  fontSize?: number;
  fontFamily?: string; // Helvetica | Times | Courier (PDF standard fonts, always exportable)
  fontStyle?: 'normal' | 'bold' | 'italic' | 'bold italic';
  /** numeric weight (100-900); when set, overrides the bold flag of fontStyle */
  fontWeight?: number;
  textDecoration?: 'none' | 'underline' | 'line-through' | 'underline line-through';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  align?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number; // multiplier, default 1.2
  letterSpacing?: number;
  /** 'none' keeps the explicit line breaks of the content (imported PDF text); default 'word' reflows to the box width */
  wrap?: 'word' | 'none';
  /** inner padding of the text box (px). New text boxes use 4, imported PDF text uses 0 */
  padding?: number;
  /** bullet/numbered list rendering applied per line of the text box */
  listStyle?: 'none' | 'bullet' | 'number';
  /** first-level indent of the whole text block, in points */
  indent?: number;
  /** superscript/subscript for the whole text box (Word's x² / x₂) */
  textScript?: 'none' | 'super' | 'sub';
  /** extra space above/below the text block, in points */
  spaceBefore?: number;
  spaceAfter?: number;
  fill?: string;
  // shapes
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  points?: number[];
  backgroundColor?: string;
  // common
  rotation?: number;
  opacity?: number;
  scaleX?: number;
  scaleY?: number;
  locked?: boolean;
  hidden?: boolean;
  name?: string;
}

export interface EditorPage {
  id: string;
  imageUrl?: string;
  originalPageIndex?: number;
  backgroundColor?: string;
  width: number;
  height: number;
  elements: EditorElement[];
  thumbnail?: string;
  /** page margins in points (top, right, bottom, left) — shown as guides, used for snapping */
  margins?: { top: number; right: number; bottom: number; left: number };
}

export interface EditorState {
  file: File | null;
  pages: EditorPage[];
  currentPageIndex: number;
  originalPdfBytes: Uint8Array | ArrayBuffer | null;
  selectedId: string | null;
  scale: number;
}

export type ToolType = 'select' | 'hand' | 'text' | 'image' | 'pen' | 'rect' | 'circle' | 'arrow';

export const PAGE_SIZES: { id: string; label: string; width: number; height: number }[] = [
  { id: 'a4', label: 'A4 retrato', width: 595, height: 842 },
  { id: 'a4l', label: 'A4 paisagem', width: 842, height: 595 },
  { id: 'letter', label: 'Carta (Letter)', width: 612, height: 792 },
  { id: 'a5', label: 'A5', width: 420, height: 595 },
  { id: 'square', label: 'Post quadrado', width: 800, height: 800 },
  { id: 'story', label: 'Story 9:16', width: 540, height: 960 }
];

/** Margens de uma pagina nova (2,54 cm em todos os lados, como no Word). */
export const DEFAULT_MARGINS: NonNullable<EditorPage['margins']> = { top: 72, right: 72, bottom: 72, left: 72 };

export const MARGIN_PRESETS: { id: string; label: string; margins: NonNullable<EditorPage['margins']> }[] = [
  { id: 'normal', label: 'Normal (2,54 cm)', margins: { ...DEFAULT_MARGINS } },
  { id: 'narrow', label: 'Estreita (1,27 cm)', margins: { top: 36, right: 36, bottom: 36, left: 36 } },
  { id: 'moderate', label: 'Moderada', margins: { top: 72, right: 54, bottom: 72, left: 54 } },
  { id: 'wide', label: 'Larga', margins: { top: 72, right: 144, bottom: 72, left: 144 } },
  { id: 'none', label: 'Sem margens', margins: { top: 0, right: 0, bottom: 0, left: 0 } }
];
export const PT_PER_MM = 72 / 25.4;
