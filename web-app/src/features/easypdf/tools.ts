/**
 * Opta Files tool registry.
 * Each entry maps a UI card to an engine REST endpoint (relative to /api/v1) and declares its options,
 * so the ToolRunner can render a form and build the multipart request automatically.
 * Field name for the main input file(s) is always `fileInput`.
 */
import { Merge, Scissors, RotateCw, Trash2, ListOrdered, Minimize2, Hash, Droplets, Stamp, ImagePlus, Layers, Wrench, EyeOff, ScanText, Images, FileSignature, ShieldCheck, ShieldOff, Lock, Unlock, FileSearch, Image as ImageIcon, FileType, FileText, Presentation, Table, Code2, Globe, FileCode, BookOpen, Ruler, Grid2X2, FileStack, Crop, Info, Type, Layers2, FileX2, Contrast, QrCode, Scaling, PenTool, type LucideIcon } from 'lucide-react';

export type ToolGroup = 'organizar' | 'converter' | 'seguranca' | 'editar' | 'avancado' | 'utilidades';

export interface ToolOption {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'color' | 'password' | 'textarea' | 'file';
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  help?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  accept?: string; // for file options
  /** send as repeated field (arrays) */
  multiple?: boolean;
  /** only render this field when another option has one of the given values */
  showIf?: { key: string; equals: string[] };
}

export interface PdfTool {
  id: string;
  name: string;
  description: string;
  group: ToolGroup;
  icon: LucideIcon;
  endpoint: string; // relative to /api/v1 (empty when `local` is set)
  /** Tools that run entirely in the browser and get their own screen instead of the generic ToolRunner */
  local?: 'qr' | 'resize' | 'vectorize';
  multiFile?: boolean; // accepts several fileInput
  minFiles?: number;
  accept?: string; // input accept
  inputLabel?: string;
  options: ToolOption[];
  output: 'pdf' | 'zip' | 'image' | 'text' | 'json' | 'auto';
  popular?: boolean;
  keywords?: string[];
  /**
   * Derives the engine endpoint and the exact multipart fields from the form values.
   * Used by tools whose UI offers friendly modes that map to different engine routes.
   * When present, the generic option→field mapping is skipped.
   */
  resolve?: (values: Record<string, unknown>) => { endpoint: string; fields: Record<string, unknown> };
}

export const TOOL_GROUPS: { id: ToolGroup; label: string; description: string }[] = [
  { id: 'organizar', label: 'Organizar', description: 'Juntar, dividir, ordenar e limpar páginas' },
  { id: 'editar', label: 'Editar & Marcar', description: 'Numeração, marca d’água, carimbos, imagens' },
  { id: 'converter', label: 'Converter', description: 'PDF ↔ Word, imagens, HTML, PDF/A e mais' },
  { id: 'seguranca', label: 'Segurança', description: 'Senhas, assinatura digital, redação e sanitização' },
  { id: 'avancado', label: 'Avançado', description: 'OCR, reparo, compressão, metadados' },
  { id: 'utilidades', label: 'Utilidades', description: 'Geradores e ferramentas rápidas do dia a dia' }
];

const PAGES_HELP = 'Ex.: 1,3,5-8 · “all” para todas';

export const PDF_TOOLS: PdfTool[] = [
  // ------------------------------------------------------------- organizar
  { id: 'merge', name: 'Juntar PDFs', description: 'Combina vários PDFs em um único arquivo, na ordem escolhida.', group: 'organizar', icon: Merge, endpoint: 'general/merge-pdfs', multiFile: true, minFiles: 2, popular: true, keywords: ['merge', 'combinar', 'unir'], output: 'pdf', options: [
    { key: 'sortType', label: 'Ordenação', type: 'select', default: 'orderProvided', options: [{ value: 'orderProvided', label: 'Ordem adicionada' }, { value: 'byFileName', label: 'Nome do arquivo' }, { value: 'byDateModified', label: 'Data de modificação' }, { value: 'byPDFTitle', label: 'Título do PDF' }] },
    { key: 'removeCertSign', label: 'Remover assinaturas digitais', type: 'boolean', default: false },
    { key: 'generateToc', label: 'Gerar sumário (bookmarks)', type: 'boolean', default: false }
  ] },
  // A divisão acontece 100% no navegador, no editor visual (SplitStudio): o usuário vê as páginas,
  // marca os cortes e o ZIP é montado com pdf-lib. Por isso a ferramenta não tem opções de formulário.
  { id: 'split', name: 'Dividir PDF', description: 'Abre as páginas na tela para você marcar onde cortar e gerar vários arquivos de uma vez.', group: 'organizar', icon: Scissors, endpoint: 'general/split-by-size-or-count', popular: true, keywords: ['split', 'separar', 'dividir', 'lote', 'contratos'], output: 'zip', options: [] },
  { id: 'rotate', name: 'Girar páginas', description: 'Gira todas as páginas em 90°, 180° ou 270°.', group: 'organizar', icon: RotateCw, endpoint: 'general/rotate-pdf', popular: true, output: 'pdf', options: [{ key: 'angle', label: 'Ângulo', type: 'select', default: '90', options: [{ value: '90', label: '90° (horário)' }, { value: '180', label: '180°' }, { value: '270', label: '270° (anti-horário)' }] }] },
  { id: 'remove-pages', name: 'Remover páginas', description: 'Exclui páginas específicas do documento.', group: 'organizar', icon: Trash2, endpoint: 'general/remove-pages', output: 'pdf', options: [{ key: 'pageNumbers', label: 'Páginas a remover', type: 'text', help: PAGES_HELP, required: true }] },
  { id: 'rearrange', name: 'Reordenar páginas', description: 'Nova ordem personalizada ou modos prontos (inverter, duplex, livreto).', group: 'organizar', icon: ListOrdered, endpoint: 'general/rearrange-pages', output: 'pdf', options: [
    { key: 'customMode', label: 'Modo', type: 'select', default: 'CUSTOM', options: [{ value: 'CUSTOM', label: 'Ordem personalizada' }, { value: 'REVERSE_ORDER', label: 'Inverter ordem' }, { value: 'DUPLEX_SORT', label: 'Ordenar duplex' }, { value: 'BOOKLET_SORT', label: 'Livreto' }, { value: 'ODD_EVEN_SPLIT', label: 'Ímpares depois pares' }, { value: 'REMOVE_FIRST', label: 'Remover primeira' }, { value: 'REMOVE_LAST', label: 'Remover última' }, { value: 'REMOVE_FIRST_AND_LAST', label: 'Remover primeira e última' }] },
    { key: 'pageNumbers', label: 'Nova ordem (modo personalizado)', type: 'text', help: 'Ex.: 3,1,2,4-6' }
  ] },
  { id: 'remove-blank', name: 'Remover páginas em branco', description: 'Detecta e remove páginas vazias automaticamente.', group: 'organizar', icon: FileX2, endpoint: 'misc/remove-blanks', output: 'auto', options: [
    { key: 'threshold', label: 'Limiar de branco (0-255)', type: 'number', default: 10, min: 0, max: 255 },
    { key: 'whitePercent', label: '% mínimo de branco', type: 'number', default: 99.9, min: 0, max: 100, step: 0.1 }
  ] },
  { id: 'multi-layout', name: 'Várias páginas por folha', description: 'Coloca 2, 4, 9 ou 16 páginas em uma única folha (N-up).', group: 'organizar', icon: Grid2X2, endpoint: 'general/multi-page-layout', output: 'pdf', options: [
    { key: 'pagesPerSheet', label: 'Páginas por folha', type: 'select', default: '2', options: ['2', '3', '4', '9', '16'].map((v) => ({ value: v, label: v })) },
    { key: 'addBorder', label: 'Adicionar borda', type: 'boolean', default: false }
  ] },
  { id: 'single-page', name: 'PDF em página única', description: 'Converte todo o documento em uma página contínua (ideal para leitura em tela).', group: 'organizar', icon: FileStack, endpoint: 'general/pdf-to-single-page', output: 'pdf', options: [] },
  { id: 'scale', name: 'Ajustar tamanho / escala', description: 'Redimensiona para A4, Carta etc. e aplica fator de escala.', group: 'organizar', icon: Ruler, endpoint: 'general/scale-pages', output: 'pdf', options: [
    { key: 'pageSize', label: 'Tamanho da página', type: 'select', default: 'A4', options: ['KEEP', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'LETTER', 'LEGAL'].map((v) => ({ value: v, label: v === 'KEEP' ? 'Manter' : v })) },
    { key: 'scaleFactor', label: 'Fator de escala', type: 'number', default: 1, min: 0.1, max: 5, step: 0.05 }
  ] },
  { id: 'crop', name: 'Cortar páginas', description: 'Recorta uma área (em pontos) de todas as páginas.', group: 'organizar', icon: Crop, endpoint: 'general/crop', output: 'pdf', options: [
    { key: 'x', label: 'X', type: 'number', default: 0 }, { key: 'y', label: 'Y', type: 'number', default: 0 }, { key: 'width', label: 'Largura', type: 'number', default: 595 }, { key: 'height', label: 'Altura', type: 'number', default: 842 }
  ] },
  { id: 'split-sections', name: 'Dividir em seções', description: 'Corta cada página em uma grade (ex.: 2×2) gerando novas páginas.', group: 'organizar', icon: Layers2, endpoint: 'general/split-pdf-by-sections', output: 'auto', options: [
    { key: 'horizontalDivisions', label: 'Divisões horizontais', type: 'number', default: 1, min: 0, max: 10 },
    { key: 'verticalDivisions', label: 'Divisões verticais', type: 'number', default: 1, min: 0, max: 10 },
    { key: 'merge', label: 'Juntar resultado em um PDF', type: 'boolean', default: true }
  ] },
  { id: 'overlay', name: 'Sobrepor PDFs', description: 'Aplica um PDF (ex.: papel timbrado) sobre as páginas de outro.', group: 'organizar', icon: Layers, endpoint: 'general/overlay-pdfs', output: 'pdf', options: [
    { key: 'overlayFiles', label: 'PDF de sobreposição', type: 'file', accept: 'application/pdf', required: true, multiple: true },
    { key: 'overlayMode', label: 'Modo', type: 'select', default: 'SequentialOverlay', options: [{ value: 'SequentialOverlay', label: 'Sequencial' }, { value: 'InterleavedOverlay', label: 'Intercalado' }, { value: 'FixedRepeatOverlay', label: 'Repetir fixo' }] },
    { key: 'overlayPosition', label: 'Posição', type: 'select', default: '0', options: [{ value: '0', label: 'Primeiro plano' }, { value: '1', label: 'Fundo' }] },
    { key: 'counts', label: 'Repetições (modo fixo)', type: 'text', default: '1' }
  ] },

  // ------------------------------------------------------------- editar
  { id: 'page-numbers', name: 'Numerar páginas', description: 'Adiciona numeração com posição, margem e texto personalizados.', group: 'editar', icon: Hash, endpoint: 'misc/add-page-numbers', popular: true, output: 'pdf', options: [
    { key: 'position', label: 'Posição', type: 'select', default: '8', options: [{ value: '1', label: 'Topo esquerda' }, { value: '2', label: 'Topo centro' }, { value: '3', label: 'Topo direita' }, { value: '7', label: 'Rodapé esquerda' }, { value: '8', label: 'Rodapé centro' }, { value: '9', label: 'Rodapé direita' }] },
    { key: 'customMargin', label: 'Margem', type: 'select', default: 'medium', options: [{ value: 'small', label: 'Pequena' }, { value: 'medium', label: 'Média' }, { value: 'large', label: 'Grande' }, { value: 'x-large', label: 'Extra grande' }] },
    { key: 'startingNumber', label: 'Começar em', type: 'number', default: 1, min: 0 },
    { key: 'pagesToNumber', label: 'Páginas a numerar', type: 'text', help: PAGES_HELP },
    { key: 'customText', label: 'Formato', type: 'text', default: '{n} / {total}', help: '{n} = página, {total} = total, {filename}' },
    { key: 'fontSize', label: 'Tamanho da fonte', type: 'number', default: 12, min: 6, max: 72 },
    { key: 'fontType', label: 'Fonte', type: 'select', default: 'Helvetica', options: ['Helvetica', 'Times', 'Courier'].map((v) => ({ value: v, label: v })) }
  ] },
  { id: 'watermark', name: 'Marca d’água', description: 'Texto ou imagem repetido com opacidade, rotação e espaçamento.', group: 'editar', icon: Droplets, endpoint: 'security/add-watermark', popular: true, output: 'pdf', options: [
    { key: 'watermarkType', label: 'Tipo', type: 'select', default: 'text', options: [{ value: 'text', label: 'Texto' }, { value: 'image', label: 'Imagem' }] },
    { key: 'watermarkText', label: 'Texto', type: 'text', default: 'Opta Files — CONFIDENCIAL' },
    { key: 'watermarkImage', label: 'Imagem (se tipo imagem)', type: 'file', accept: 'image/*' },
    { key: 'alphabet', label: 'Alfabeto', type: 'select', default: 'roman', options: [{ value: 'roman', label: 'Latino' }, { value: 'arabic', label: 'Árabe' }, { value: 'japanese', label: 'Japonês' }, { value: 'korean', label: 'Coreano' }, { value: 'chinese', label: 'Chinês' }] },
    { key: 'fontSize', label: 'Tamanho', type: 'number', default: 30, min: 6, max: 200 },
    { key: 'rotation', label: 'Rotação (°)', type: 'number', default: 45, min: -180, max: 180 },
    { key: 'opacity', label: 'Opacidade (0-1)', type: 'number', default: 0.3, min: 0.05, max: 1, step: 0.05 },
    { key: 'widthSpacer', label: 'Espaço horizontal', type: 'number', default: 50 },
    { key: 'heightSpacer', label: 'Espaço vertical', type: 'number', default: 50 },
    { key: 'customColor', label: 'Cor', type: 'color', default: '#1b3f8b' },
    { key: 'convertPDFToImage', label: 'Converter para imagem (não removível)', type: 'boolean', default: false }
  ] },
  { id: 'stamp', name: 'Carimbo', description: 'Aplica um carimbo de texto ou imagem em posição fixa (ex.: “PAGO”, “APROVADO”).', group: 'editar', icon: Stamp, endpoint: 'misc/add-stamp', output: 'pdf', options: [
    { key: 'stampType', label: 'Tipo', type: 'select', default: 'text', options: [{ value: 'text', label: 'Texto' }, { value: 'image', label: 'Imagem' }] },
    { key: 'stampText', label: 'Texto', type: 'text', default: 'APROVADO' },
    { key: 'stampImage', label: 'Imagem', type: 'file', accept: 'image/*' },
    { key: 'pageNumbers', label: 'Páginas', type: 'text', default: 'all', help: PAGES_HELP },
    { key: 'position', label: 'Posição', type: 'select', default: '3', options: [{ value: '1', label: 'Topo esquerda' }, { value: '2', label: 'Topo centro' }, { value: '3', label: 'Topo direita' }, { value: '4', label: 'Meio esquerda' }, { value: '5', label: 'Centro' }, { value: '6', label: 'Meio direita' }, { value: '7', label: 'Rodapé esquerda' }, { value: '8', label: 'Rodapé centro' }, { value: '9', label: 'Rodapé direita' }] },
    { key: 'fontSize', label: 'Tamanho', type: 'number', default: 30 },
    { key: 'rotation', label: 'Rotação (°)', type: 'number', default: 0 },
    { key: 'opacity', label: 'Opacidade (0-1)', type: 'number', default: 0.5, min: 0.05, max: 1, step: 0.05 },
    { key: 'customMargin', label: 'Margem', type: 'select', default: 'medium', options: [{ value: 'small', label: 'Pequena' }, { value: 'medium', label: 'Média' }, { value: 'large', label: 'Grande' }] },
    { key: 'customColor', label: 'Cor', type: 'color', default: '#2e8b3d' },
    { key: 'alphabet', label: 'Alfabeto', type: 'select', default: 'roman', options: [{ value: 'roman', label: 'Latino' }] }
  ] },
  { id: 'add-image', name: 'Inserir imagem', description: 'Adiciona uma imagem (logo, assinatura) em coordenadas definidas.', group: 'editar', icon: ImagePlus, endpoint: 'misc/add-image', output: 'pdf', options: [
    { key: 'imageFile', label: 'Imagem', type: 'file', accept: 'image/*', required: true },
    { key: 'x', label: 'X (pt)', type: 'number', default: 40 }, { key: 'y', label: 'Y (pt)', type: 'number', default: 40 },
    { key: 'everyPage', label: 'Em todas as páginas', type: 'boolean', default: true }
  ] },
  { id: 'flatten', name: 'Achatar (flatten)', description: 'Converte formulários e anotações em conteúdo fixo, impedindo edições.', group: 'editar', icon: Layers, endpoint: 'misc/flatten', output: 'pdf', options: [{ key: 'flattenOnlyForms', label: 'Somente formulários', type: 'boolean', default: false }] },
  { id: 'invert', name: 'Cores / alto contraste', description: 'Inverte cores ou aplica alto contraste para leitura e impressão.', group: 'editar', icon: Contrast, endpoint: 'misc/replace-invert-pdf', output: 'pdf', options: [
    { key: 'replaceAndInvertOption', label: 'Modo', type: 'select', default: 'HIGH_CONTRAST_COLOR', options: [{ value: 'HIGH_CONTRAST_COLOR', label: 'Alto contraste' }, { value: 'FULL_INVERSION', label: 'Inversão total' }, { value: 'CUSTOM_COLOR', label: 'Cores personalizadas' }] },
    { key: 'highContrastColorCombination', label: 'Combinação (alto contraste)', type: 'select', default: 'WHITE_TEXT_ON_BLACK', options: [{ value: 'WHITE_TEXT_ON_BLACK', label: 'Branco no preto' }, { value: 'BLACK_TEXT_ON_WHITE', label: 'Preto no branco' }, { value: 'YELLOW_TEXT_ON_BLACK', label: 'Amarelo no preto' }, { value: 'GREEN_TEXT_ON_BLACK', label: 'Verde no preto' }] },
    { key: 'backGroundColor', label: 'Fundo (personalizado)', type: 'color', default: '#ffffff' },
    { key: 'textColor', label: 'Texto (personalizado)', type: 'color', default: '#000000' }
  ] },
  { id: 'remove-images', name: 'Remover imagens', description: 'Remove todas as imagens, mantendo o texto (reduz tamanho).', group: 'editar', icon: EyeOff, endpoint: 'general/remove-image-pdf', output: 'pdf', options: [] },

  // ------------------------------------------------------------- converter
  { id: 'pdf-to-img', name: 'PDF → Imagem', description: 'Exporta páginas como PNG, JPG ou WEBP com DPI configurável.', group: 'converter', icon: ImageIcon, endpoint: 'convert/pdf/img', popular: true, output: 'auto', options: [
    { key: 'imageFormat', label: 'Formato', type: 'select', default: 'png', options: ['png', 'jpg', 'webp', 'gif'].map((v) => ({ value: v, label: v.toUpperCase() })) },
    { key: 'singleOrMultiple', label: 'Saída', type: 'select', default: 'multiple', options: [{ value: 'multiple', label: 'Uma imagem por página (ZIP)' }, { value: 'single', label: 'Imagem única' }] },
    { key: 'colorType', label: 'Cores', type: 'select', default: 'color', options: [{ value: 'color', label: 'Colorido' }, { value: 'greyscale', label: 'Cinza' }, { value: 'blackwhite', label: 'Preto e branco' }] },
    { key: 'dpi', label: 'DPI', type: 'number', default: 150, min: 50, max: 600 },
    { key: 'pageNumbers', label: 'Páginas', type: 'text', default: 'all', help: PAGES_HELP }
  ] },
  { id: 'img-to-pdf', name: 'Imagem → PDF', description: 'Converte fotos e digitalizações (JPG, PNG, WEBP) em PDF.', group: 'converter', icon: Images, endpoint: 'convert/img/pdf', popular: true, multiFile: true, accept: 'image/*', inputLabel: 'imagens', output: 'pdf', options: [
    { key: 'fitOption', label: 'Ajuste', type: 'select', default: 'fillPage', options: [{ value: 'fillPage', label: 'Preencher página' }, { value: 'fitDocumentToImage', label: 'Página do tamanho da imagem' }, { value: 'maintainAspectRatio', label: 'Manter proporção' }] },
    { key: 'colorType', label: 'Cores', type: 'select', default: 'color', options: [{ value: 'color', label: 'Colorido' }, { value: 'greyscale', label: 'Cinza' }, { value: 'blackwhite', label: 'Preto e branco' }] },
    { key: 'autoRotate', label: 'Rotação automática', type: 'boolean', default: true }
  ] },
  { id: 'pdf-to-word', name: 'PDF → Word', description: 'Gera DOCX/ODT editável a partir do PDF.', group: 'converter', icon: FileType, endpoint: 'convert/pdf/word', popular: true, output: 'auto', options: [{ key: 'outputFormat', label: 'Formato', type: 'select', default: 'docx', options: ['docx', 'odt', 'doc'].map((v) => ({ value: v, label: v.toUpperCase() })) }] },
  { id: 'pdf-to-ppt', name: 'PDF → PowerPoint', description: 'Converte para apresentação PPTX/ODP.', group: 'converter', icon: Presentation, endpoint: 'convert/pdf/presentation', output: 'auto', options: [{ key: 'outputFormat', label: 'Formato', type: 'select', default: 'pptx', options: ['pptx', 'odp', 'ppt'].map((v) => ({ value: v, label: v.toUpperCase() })) }] },
  { id: 'pdf-to-text', name: 'PDF → Texto / RTF', description: 'Extrai o texto para TXT ou RTF.', group: 'converter', icon: FileText, endpoint: 'convert/pdf/text', output: 'auto', options: [{ key: 'outputFormat', label: 'Formato', type: 'select', default: 'txt', options: ['txt', 'rtf'].map((v) => ({ value: v, label: v.toUpperCase() })) }] },
  { id: 'pdf-to-csv', name: 'PDF → CSV (tabelas)', description: 'Extrai tabelas de uma página para planilha.', group: 'converter', icon: Table, endpoint: 'convert/pdf/csv', output: 'auto', options: [{ key: 'pageNumbers', label: 'Páginas', type: 'text', default: '1', help: PAGES_HELP }] },
  { id: 'pdf-to-html', name: 'PDF → HTML', description: 'Converte o documento em página web.', group: 'converter', icon: Code2, endpoint: 'convert/pdf/html', output: 'auto', options: [] },
  { id: 'pdf-to-xml', name: 'PDF → XML', description: 'Estrutura o conteúdo em XML.', group: 'converter', icon: FileCode, endpoint: 'convert/pdf/xml', output: 'auto', options: [] },
  { id: 'pdf-to-pdfa', name: 'PDF → PDF/A', description: 'Padrão de arquivamento de longo prazo (PDF/A-1b / 2b).', group: 'converter', icon: BookOpen, endpoint: 'convert/pdf/pdfa', output: 'pdf', options: [{ key: 'outputFormat', label: 'Versão', type: 'select', default: 'pdfa', options: [{ value: 'pdfa', label: 'PDF/A-2b' }, { value: 'pdfa-1', label: 'PDF/A-1b' }] }] },
  { id: 'file-to-pdf', name: 'Office → PDF', description: 'Word, Excel, PowerPoint, ODT e outros formatos para PDF.', group: 'converter', icon: FileText, endpoint: 'convert/file/pdf', accept: '.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv', inputLabel: 'arquivo Office', popular: true, output: 'pdf', options: [] },
  { id: 'html-to-pdf', name: 'HTML → PDF', description: 'Arquivo HTML (ou ZIP com recursos) para PDF.', group: 'converter', icon: Code2, endpoint: 'convert/html/pdf', accept: '.html,.htm,.zip', inputLabel: 'arquivo HTML', output: 'pdf', options: [{ key: 'zoom', label: 'Zoom', type: 'number', default: 1, min: 0.1, max: 3, step: 0.1 }] },
  { id: 'url-to-pdf', name: 'Site (URL) → PDF', description: 'Captura uma página web como PDF.', group: 'converter', icon: Globe, endpoint: 'convert/url/pdf', accept: '', output: 'pdf', options: [{ key: 'urlInput', label: 'URL', type: 'text', default: 'https://', required: true }] },
  { id: 'md-to-pdf', name: 'Markdown → PDF', description: 'Converte arquivos .md em PDF formatado.', group: 'converter', icon: Type, endpoint: 'convert/markdown/pdf', accept: '.md,.markdown', inputLabel: 'arquivo Markdown', output: 'pdf', options: [] },

  // ------------------------------------------------------------- segurança
  { id: 'add-password', name: 'Proteger com senha', description: 'Criptografa o PDF e define permissões (impressão, cópia, edição).', group: 'seguranca', icon: Lock, endpoint: 'security/add-password', popular: true, output: 'pdf', options: [
    { key: 'password', label: 'Senha de abertura', type: 'password', required: true },
    { key: 'ownerPassword', label: 'Senha de proprietário', type: 'password' },
    { key: 'keyLength', label: 'Criptografia', type: 'select', default: '256', options: [{ value: '128', label: 'AES 128' }, { value: '256', label: 'AES 256' }] },
    { key: 'preventPrinting', label: 'Impedir impressão', type: 'boolean', default: false },
    { key: 'preventExtractContent', label: 'Impedir cópia de conteúdo', type: 'boolean', default: false },
    { key: 'preventModify', label: 'Impedir modificação', type: 'boolean', default: false },
    { key: 'preventFillInForm', label: 'Impedir preenchimento de formulários', type: 'boolean', default: false }
  ] },
  { id: 'remove-password', name: 'Remover senha', description: 'Desbloqueia um PDF protegido (é preciso conhecer a senha).', group: 'seguranca', icon: Unlock, endpoint: 'security/remove-password', output: 'pdf', options: [{ key: 'password', label: 'Senha atual', type: 'password', required: true }] },
  { id: 'validate-sign', name: 'Validar assinatura', description: 'Confere integridade, signatário, cadeia de confiança, validade e revogação das assinaturas do PDF.', group: 'seguranca', icon: ShieldCheck, endpoint: 'security/validate-signature', output: 'json', popular: true, keywords: ['validar', 'verificar', 'assinatura', 'autenticidade'], options: [
    { key: 'certFile', label: 'Certificado da AC (opcional)', type: 'file', accept: '.crt,.cer,.pem,.der', help: 'Raiz ou intermediária para validar a cadeia. Sem ela, só passam certificados já confiáveis no servidor.' }
  ] },
  { id: 'cert-sign', name: 'Assinar digitalmente', description: 'Assinatura com certificado (PKCS#12 / PEM) e carimbo visual opcional.', group: 'seguranca', icon: FileSignature, popular: true, endpoint: 'security/cert-sign', output: 'pdf', options: [
    { key: 'certType', label: 'Tipo de certificado', type: 'select', default: 'PKCS12', options: [{ value: 'PKCS12', label: 'PKCS#12 (.p12/.pfx)' }, { value: 'PEM', label: 'PEM (chave + certificado)' }, { value: 'JKS', label: 'Java KeyStore' }] },
    { key: 'p12File', label: 'Arquivo .p12/.pfx', type: 'file', accept: '.p12,.pfx' },
    { key: 'privateKeyFile', label: 'Chave privada (PEM)', type: 'file', accept: '.pem,.key' },
    { key: 'certFile', label: 'Certificado (PEM)', type: 'file', accept: '.pem,.crt,.cer' },
    { key: 'jksFile', label: 'KeyStore (JKS)', type: 'file', accept: '.jks' },
    { key: 'password', label: 'Senha do certificado', type: 'password' },
    { key: 'showSignature', label: 'Mostrar assinatura visual', type: 'boolean', default: true },
    { key: 'reason', label: 'Motivo', type: 'text', default: 'Aprovação de documento' },
    { key: 'location', label: 'Local', type: 'text', default: '' },
    { key: 'name', label: 'Nome do signatário', type: 'text', default: 'Opta Files' },
    { key: 'pageNumber', label: 'Página da assinatura', type: 'number', default: 1, min: 1 },
    { key: 'showLogo', label: 'Mostrar logo', type: 'boolean', default: false }
  ] },
  { id: 'remove-cert', name: 'Remover assinatura digital', description: 'Remove assinaturas certificadas do documento.', group: 'seguranca', icon: ShieldOff, endpoint: 'security/remove-cert-sign', output: 'pdf', options: [] },
  { id: 'sanitize', name: 'Sanitizar', description: 'Remove JavaScript, anexos, metadados, links e fontes embutidas.', group: 'seguranca', icon: ShieldCheck, endpoint: 'security/sanitize-pdf', output: 'pdf', options: [
    { key: 'removeJavaScript', label: 'Remover JavaScript', type: 'boolean', default: true },
    { key: 'removeEmbeddedFiles', label: 'Remover anexos', type: 'boolean', default: true },
    { key: 'removeXMPMetadata', label: 'Remover metadados XMP', type: 'boolean', default: false },
    { key: 'removeMetadata', label: 'Remover metadados', type: 'boolean', default: false },
    { key: 'removeLinks', label: 'Remover links', type: 'boolean', default: false },
    { key: 'removeFonts', label: 'Remover fontes', type: 'boolean', default: false }
  ] },
  { id: 'redact', name: 'Redação automática', description: 'Tarja termos sensíveis (CPF, valores, nomes) por texto ou regex.', group: 'seguranca', icon: EyeOff, endpoint: 'security/auto-redact', output: 'pdf', options: [
    { key: 'listOfText', label: 'Termos (um por linha)', type: 'textarea', required: true },
    { key: 'useRegex', label: 'Usar regex', type: 'boolean', default: false },
    { key: 'wholeWordSearch', label: 'Palavra inteira', type: 'boolean', default: false },
    { key: 'customColor', label: 'Cor da tarja', type: 'color', default: '#000000' },
    { key: 'customPadding', label: 'Margem da tarja', type: 'number', default: 2 },
    { key: 'convertPDFToImage', label: 'Converter em imagem (irreversível)', type: 'boolean', default: true }
  ] },
  { id: 'pdf-info', name: 'Informações do PDF', description: 'Metadados, permissões, assinaturas, fontes e estrutura em JSON.', group: 'seguranca', icon: Info, endpoint: 'security/get-info-on-pdf', output: 'json', options: [] },

  // ------------------------------------------------------------- avançado
  { id: 'compress', name: 'Comprimir', description: 'Reduz o tamanho do arquivo com níveis de otimização inteligentes.', group: 'avancado', icon: Minimize2, endpoint: 'misc/compress-pdf', popular: true, output: 'pdf', options: [
    { key: 'optimizeLevel', label: 'Nível (1 leve – 9 máximo)', type: 'number', default: 5, min: 1, max: 9 },
    { key: 'expectedOutputSize', label: 'Tamanho alvo (ex.: 2MB)', type: 'text', help: 'Opcional; sobrepõe o nível' },
    { key: 'linearize', label: 'Otimizar para web (linearizar)', type: 'boolean', default: false },
    { key: 'grayscale', label: 'Converter para tons de cinza', type: 'boolean', default: false }
  ] },
  { id: 'ocr', name: 'OCR (reconhecer texto)', description: 'Torna PDFs digitalizados pesquisáveis e copiáveis. Suporta PT e EN.', group: 'avancado', icon: ScanText, popular: true, endpoint: 'misc/ocr-pdf', output: 'auto', options: [
    { key: 'languages', label: 'Idiomas', type: 'select', default: 'por', multiple: true, options: [{ value: 'por', label: 'Português' }, { value: 'eng', label: 'Inglês' }, { value: 'spa', label: 'Espanhol' }, { value: 'fra', label: 'Francês' }, { value: 'deu', label: 'Alemão' }, { value: 'ita', label: 'Italiano' }] },
    { key: 'ocrType', label: 'Modo', type: 'select', default: 'skip-text', options: [{ value: 'skip-text', label: 'Pular páginas com texto' }, { value: 'force-ocr', label: 'Forçar OCR' }, { value: 'Normal', label: 'Normal' }] },
    { key: 'ocrRenderType', label: 'Renderização', type: 'select', default: 'hocr', options: [{ value: 'hocr', label: 'hOCR' }, { value: 'sandwich', label: 'Sandwich' }] },
    { key: 'deskew', label: 'Endireitar', type: 'boolean', default: true },
    { key: 'clean', label: 'Limpar ruído', type: 'boolean', default: true },
    { key: 'sidecar', label: 'Gerar .txt separado', type: 'boolean', default: false }
  ] },
  { id: 'repair', name: 'Reparar PDF', description: 'Tenta corrigir arquivos corrompidos ou que não abrem.', group: 'avancado', icon: Wrench, endpoint: 'misc/repair', output: 'pdf', options: [] },
  { id: 'extract-images', name: 'Extrair imagens', description: 'Salva todas as imagens do PDF em um ZIP.', group: 'avancado', icon: Images, endpoint: 'misc/extract-images', output: 'zip', options: [
    { key: 'format', label: 'Formato', type: 'select', default: 'png', options: ['png', 'jpeg', 'gif'].map((v) => ({ value: v, label: v.toUpperCase() })) },
    { key: 'allowDuplicates', label: 'Permitir duplicadas', type: 'boolean', default: false }
  ] },
  { id: 'metadata', name: 'Editar metadados', description: 'Título, autor, assunto, palavras-chave, criador.', group: 'avancado', icon: FileSearch, endpoint: 'misc/update-metadata', output: 'pdf', options: [
    { key: 'title', label: 'Título', type: 'text' }, { key: 'author', label: 'Autor', type: 'text', default: 'Opta Files' }, { key: 'subject', label: 'Assunto', type: 'text' }, { key: 'keywords', label: 'Palavras-chave', type: 'text' }, { key: 'creator', label: 'Criador', type: 'text', default: 'Opta Files' }, { key: 'producer', label: 'Produtor', type: 'text' },
    { key: 'deleteAll', label: 'Apagar todos os metadados', type: 'boolean', default: false }
  ] },
  { id: 'auto-rename', name: 'Renomear automaticamente', description: 'Usa o título/primeira linha do conteúdo como nome do arquivo.', group: 'avancado', icon: Type, endpoint: 'misc/auto-rename', output: 'pdf', options: [{ key: 'useFirstTextAsFallback', label: 'Usar primeiro texto se não houver título', type: 'boolean', default: true }] },
  { id: 'extract-scans', name: 'Extrair digitalizações', description: 'Detecta fotos de documentos em páginas e recorta cada uma.', group: 'avancado', icon: ScanText, endpoint: 'misc/extract-image-scans', output: 'zip', options: [
    { key: 'angleThreshold', label: 'Limiar de ângulo', type: 'number', default: 5 }, { key: 'tolerance', label: 'Tolerância', type: 'number', default: 20 }, { key: 'minArea', label: 'Área mínima', type: 'number', default: 8000 }, { key: 'minContourArea', label: 'Área mínima do contorno', type: 'number', default: 500 }, { key: 'borderSize', label: 'Borda', type: 'number', default: 1 }
  ] },

  // ------------------------------------------------------------- utilidades
  { id: 'image-resize', name: 'Redimensionar imagem', description: 'Mude a dimensao da imagem em px, %, cm ou polegadas, com proporcao travada, atalhos prontos e escolha de formato e qualidade.', group: 'converter', icon: Scaling, local: 'resize', endpoint: '', accept: 'image/*', multiFile: true, inputLabel: 'imagens', popular: true, keywords: ['resize', 'redimensionar', 'tamanho', 'dimensao', 'escala', 'px', 'imagem', 'foto', 'comprimir'], output: 'image', options: [] },
  { id: 'image-vectorize', name: 'Vetorizar imagem', description: 'Transforme PNG ou JPG em SVG de verdade, com curvas editaveis que escalam sem perder qualidade. Presets para logo, foto, traco e pixel art.', group: 'converter', icon: PenTool, local: 'vectorize', endpoint: '', accept: 'image/*', multiFile: true, inputLabel: 'imagens', popular: true, keywords: ['vetor', 'vetorizar', 'svg', 'trace', 'vector', 'logo', 'curva', 'bitmap', 'raster', 'contorno'], output: 'image', options: [] },
  { id: 'qr-code', name: 'Gerador de QR Code', description: 'Crie QR codes de link, Wi-Fi, contato, WhatsApp, e-mail ou PIX, com cores e logo. Baixe em PNG, SVG ou PDF.', group: 'utilidades', icon: QrCode, local: 'qr', endpoint: '', accept: '', popular: true, keywords: ['qr', 'qrcode', 'codigo', 'pix', 'wifi', 'vcard', 'whatsapp', 'link'], output: 'image', options: [] }
];

export const findTool = (id: string) => PDF_TOOLS.find((t) => t.id === id);

/** Local-only tools that live in the visual editor (run in the browser) */
export const EDITOR_TOOL_ID = 'visual-editor';
