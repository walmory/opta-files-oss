/** Vector icon library (24×24 viewBox SVG path data). Rendered with Konva.Path and exported with pdf-lib drawSvgPath. */
export interface StudioIcon {
  id: string;
  label: string;
  data: string;
  /** stroke-based icon (default) vs filled */
  filled?: boolean;
}

export const STUDIO_ICONS: StudioIcon[] = [
  { id: 'check', label: 'Check', data: 'M4 12 L9 17 L20 6' },
  { id: 'check-circle', label: 'Check círculo', data: 'M12 2 A10 10 0 1 0 12 22 A10 10 0 1 0 12 2 Z M8 12 L11 15 L16 9' },
  { id: 'x', label: 'X', data: 'M6 6 L18 18 M18 6 L6 18' },
  { id: 'arrow-right', label: 'Seta', data: 'M4 12 H20 M14 6 L20 12 L14 18' },
  { id: 'truck', label: 'Caminhão', data: 'M1 6 H15 V17 H1 Z M15 10 H19 L23 14 V17 H15 Z M5 20 A2 2 0 1 0 5 16 A2 2 0 1 0 5 20 Z M19 20 A2 2 0 1 0 19 16 A2 2 0 1 0 19 20 Z' },
  { id: 'box', label: 'Caixa', data: 'M12 2 L21 7 V17 L12 22 L3 17 V7 Z M12 22 V12 M3 7 L12 12 L21 7' },
  { id: 'home', label: 'Casa', data: 'M3 11 L12 3 L21 11 V21 H15 V15 H9 V21 H3 Z' },
  { id: 'pin', label: 'Pino mapa', data: 'M12 22 C12 22 5 14.5 5 10 A7 7 0 0 1 19 10 C19 14.5 12 22 12 22 Z M12 13 A3 3 0 1 0 12 7 A3 3 0 1 0 12 13 Z' },
  { id: 'phone', label: 'Telefone', data: 'M5 3 H9 L11 8 L8.5 9.5 A11 11 0 0 0 14.5 15.5 L16 13 L21 15 V19 A2 2 0 0 1 19 21 A16 16 0 0 1 3 5 A2 2 0 0 1 5 3 Z' },
  { id: 'mail', label: 'E-mail', data: 'M3 5 H21 V19 H3 Z M3 6 L12 13 L21 6' },
  { id: 'calendar', label: 'Calendário', data: 'M3 5 H21 V21 H3 Z M3 10 H21 M8 3 V7 M16 3 V7' },
  { id: 'clock', label: 'Relógio', data: 'M12 2 A10 10 0 1 0 12 22 A10 10 0 1 0 12 2 Z M12 7 V12 L15 14' },
  { id: 'star', label: 'Estrela', data: 'M12 2 L14.9 8.6 L22 9.3 L16.5 14 L18.2 21 L12 17.3 L5.8 21 L7.5 14 L2 9.3 L9.1 8.6 Z', filled: true },
  { id: 'heart', label: 'Coração', data: 'M12 21 C12 21 3 14 3 8.5 A4.5 4.5 0 0 1 12 6 A4.5 4.5 0 0 1 21 8.5 C21 14 12 21 12 21 Z', filled: true },
  { id: 'shield', label: 'Escudo', data: 'M12 2 L20 5 V11 C20 16 16.5 20 12 22 C7.5 20 4 16 4 11 V5 Z' },
  { id: 'user', label: 'Pessoa', data: 'M12 12 A4 4 0 1 0 12 4 A4 4 0 1 0 12 12 Z M4 21 C4 16.5 7.5 14 12 14 C16.5 14 20 16.5 20 21' },
  { id: 'users', label: 'Equipe', data: 'M9 11 A3.5 3.5 0 1 0 9 4 A3.5 3.5 0 1 0 9 11 Z M2 20 C2 16 5 13.5 9 13.5 C13 13.5 16 16 16 20 M16 4.5 A3.5 3.5 0 0 1 16 11 M18 13.8 C21 14.5 22 17 22 20' },
  { id: 'globe', label: 'Globo', data: 'M12 2 A10 10 0 1 0 12 22 A10 10 0 1 0 12 2 Z M2 12 H22 M12 2 C15 6 15 18 12 22 M12 2 C9 6 9 18 12 22' },
  { id: 'money', label: 'Dinheiro', data: 'M2 6 H22 V18 H2 Z M12 15 A3 3 0 1 0 12 9 A3 3 0 1 0 12 15 Z M5 9 H5.01 M19 15 H19.01' },
  { id: 'file', label: 'Documento', data: 'M6 2 H14 L20 8 V22 H6 Z M14 2 V8 H20 M9 13 H17 M9 17 H17' },
  { id: 'sign', label: 'Assinatura', data: 'M3 20 C6 14 8 14 9 17 C10 20 12 12 13 10 C14 8 15 15 16 15 C17 15 18 12 21 12' },
  { id: 'qr', label: 'QR', data: 'M3 3 H9 V9 H3 Z M15 3 H21 V9 H15 Z M3 15 H9 V21 H3 Z M15 15 H17 V17 H15 Z M19 15 H21 V17 H19 Z M15 19 H17 V21 H15 Z M19 19 H21 V21 H19 Z', filled: true },
  { id: 'wifi', label: 'Wi-Fi', data: 'M2 9 C8 3 16 3 22 9 M5 12.5 C9 8.5 15 8.5 19 12.5 M8.5 16 C10.5 14 13.5 14 15.5 16 M12 19.5 H12.01' },
  { id: 'lightning', label: 'Raio', data: 'M13 2 L4 14 H11 L10 22 L20 9 H13 Z', filled: true },
  { id: 'triangle', label: 'Triângulo', data: 'M12 3 L22 21 H2 Z', filled: true },
  { id: 'hexagon', label: 'Hexágono', data: 'M12 2 L21 7 V17 L12 22 L3 17 V7 Z', filled: true },
  { id: 'diamond', label: 'Losango', data: 'M12 2 L22 12 L12 22 L2 12 Z', filled: true },
  { id: 'badge', label: 'Selo', data: 'M12 2 L14.5 4.5 L18 4 L18.5 7.5 L21.5 9.5 L20 12.5 L21.5 15.5 L18.5 17.5 L18 21 L14.5 20.5 L12 23 L9.5 20.5 L6 21 L5.5 17.5 L2.5 15.5 L4 12.5 L2.5 9.5 L5.5 7.5 L6 4 L9.5 4.5 Z', filled: true }
];
