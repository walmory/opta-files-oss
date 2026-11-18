import type { EditorElement, EditorPage } from '../../types/pdfEditor';
import { getPdfBrandingAssets } from '../../utils/pdfBranding';

const uid = () => crypto.randomUUID();
const INK = '#0f172a';
const MUTED = '#64748b';

const text = (p: Partial<EditorElement> & { content: string; x: number; y: number; width: number }): EditorElement => ({
  id: uid(),
  type: 'text',
  height: Math.round((p.fontSize || 14) * 1.5),
  fontFamily: 'Helvetica',
  fontSize: 14,
  fill: INK,
  align: 'left',
  lineHeight: 1.25,
  name: p.content.slice(0, 24),
  ...p
});
const rect = (p: Partial<EditorElement> & { x: number; y: number; width: number; height: number; fill: string }): EditorElement => ({ id: uid(), type: 'rect', content: '', name: 'Retângulo', ...p });
const line = (x: number, y: number, w: number, color = '#e2e8f0', sw = 1): EditorElement => ({ id: uid(), type: 'line', content: '', x, y, width: w, height: 0, points: [0, 0, w, 0], stroke: color, strokeWidth: sw, name: 'Linha' });
const logo = (logoUrl: string, x: number, y: number, w = 140): EditorElement => ({ id: uid(), type: 'image', content: logoUrl, x, y, width: w, height: Math.round(w * 0.24), name: 'Logo' });

export interface StudioTemplate {
  id: string;
  name: string;
  description: string;
  build: () => EditorPage;
}

const A4 = { width: 595, height: 842 };

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  {
    id: 'blank',
    name: 'Página em branco',
    description: 'A4, fundo branco.',
    build: () => ({ id: uid(), ...A4, backgroundColor: '#ffffff', elements: [] })
  },
  {
    id: 'letterhead',
    name: 'Papel timbrado',
    description: 'Cabeçalho com logo, faixa de cor e rodapé com contatos.',
    build: () => {
      const brand = getPdfBrandingAssets();
      return {
        id: uid(),
        ...A4,
        backgroundColor: '#ffffff',
        elements: [
          rect({ x: 0, y: 0, width: 595, height: 8, fill: brand.primaryColor, name: 'Faixa topo' }),
          rect({ x: 0, y: 8, width: 595, height: 3, fill: brand.secondaryColor, name: 'Faixa cor' }),
          logo(brand.logoUrl, 40, 34),
          text({ content: `${brand.companyName} International Transport & Removals`, x: 300, y: 36, width: 255, fontSize: 10, fontStyle: 'bold', fill: brand.primaryColor, align: 'right' }),
          text({ content: 'London · Lisboa · São Paulo\ncontact@optafiles.com · +44 20 0000 0000', x: 300, y: 52, width: 255, height: 30, fontSize: 9, fill: MUTED, align: 'right' }),
          line(40, 96, 515, '#cbd5e1', 1),
          text({ content: 'Título do documento', x: 40, y: 120, width: 515, fontSize: 22, fontStyle: 'bold', fill: INK, name: 'Título' }),
          text({ content: 'Escreva aqui o corpo do documento. Este modelo já traz identidade visual e margens corretas para impressão.', x: 40, y: 160, width: 515, height: 60, fontSize: 11, fill: '#334155', name: 'Corpo' }),
          rect({ x: 0, y: 802, width: 595, height: 40, fill: '#f1f5f9', name: 'Rodapé' }),
          text({ content: `${brand.companyName} Ltd · Company No. 00000000 · VAT GB000000000 · www.optafiles.com`, x: 40, y: 816, width: 515, fontSize: 8, fill: MUTED, align: 'center' })
        ]
      };
    }
  },
  {
    id: 'quote',
    name: 'Orçamento',
    description: 'Proposta comercial com tabela de valores e condições.',
    build: () => {
      const brand = getPdfBrandingAssets();
      return {
        id: uid(),
        ...A4,
        backgroundColor: '#ffffff',
        elements: [
          rect({ x: 0, y: 0, width: 595, height: 90, fill: brand.primaryColor, name: 'Cabeçalho' }),
          logo(brand.logoUrl, 40, 30, 130),
          text({ content: 'ORÇAMENTO', x: 300, y: 30, width: 255, fontSize: 24, fontStyle: 'bold', fill: '#ffffff', align: 'right' }),
          text({ content: '#QU-0000 · 00/00/2026', x: 300, y: 62, width: 255, fontSize: 10, fill: '#c7d2fe', align: 'right' }),
          text({ content: 'CLIENTE', x: 40, y: 115, width: 200, fontSize: 9, fontStyle: 'bold', fill: MUTED }),
          text({ content: 'Nome do cliente\n+44 7000 000000\ncliente@email.com', x: 40, y: 130, width: 240, height: 48, fontSize: 11, fill: INK }),
          text({ content: 'ROTA', x: 320, y: 115, width: 200, fontSize: 9, fontStyle: 'bold', fill: MUTED }),
          text({ content: 'Origem: London SW1A 1AA\nDestino: Manchester M1 1AE\nData prevista: 15/10/2026', x: 320, y: 130, width: 235, height: 48, fontSize: 11, fill: INK }),
          rect({ x: 40, y: 200, width: 515, height: 28, fill: '#e2e8f0', name: 'Tabela cabeçalho' }),
          text({ content: 'Descrição', x: 50, y: 207, width: 300, fontSize: 10, fontStyle: 'bold', fill: INK }),
          text({ content: 'Valor', x: 420, y: 207, width: 125, fontSize: 10, fontStyle: 'bold', fill: INK, align: 'right' }),
          text({ content: 'Taxa base (equipe + veículo)\nVolume estimado (25 m³)\nDistância\nEmbalagem', x: 50, y: 240, width: 300, height: 80, fontSize: 11, fill: '#334155', lineHeight: 1.6 }),
          text({ content: '£150\n£1.125\n£210\n£300', x: 420, y: 240, width: 125, height: 80, fontSize: 11, fill: '#334155', align: 'right', lineHeight: 1.6 }),
          line(40, 330, 515, '#cbd5e1', 1),
          rect({ x: 355, y: 345, width: 200, height: 44, fill: brand.secondaryColor, cornerRadius: 8, name: 'Total' }),
          text({ content: 'TOTAL', x: 365, y: 359, width: 60, fontSize: 11, fontStyle: 'bold', fill: '#ffffff' }),
          text({ content: '£1.785', x: 430, y: 355, width: 115, fontSize: 18, fontStyle: 'bold', fill: '#ffffff', align: 'right' }),
          text({ content: 'CONDIÇÕES', x: 40, y: 420, width: 200, fontSize: 9, fontStyle: 'bold', fill: MUTED }),
          text({ content: '• Validade de 14 dias.\n• Reserva mediante depósito de 30%; saldo no dia do serviço.\n• Inclui equipe profissional, veículo, proteção básica e seguro padrão.\n• Não inclui estacionamento, pedágios e itens não informados.', x: 40, y: 436, width: 515, height: 80, fontSize: 10, fill: '#334155', lineHeight: 1.5 }),
          rect({ x: 0, y: 802, width: 595, height: 40, fill: '#f1f5f9' }),
          text({ content: `Obrigado pela preferência · ${brand.companyName} Nexus`, x: 40, y: 816, width: 515, fontSize: 8, fill: MUTED, align: 'center' })
        ]
      };
    }
  },
  {
    id: 'receipt',
    name: 'Recibo',
    description: 'Comprovante de pagamento com assinatura.',
    build: () => {
      const brand = getPdfBrandingAssets();
      return {
        id: uid(),
        ...A4,
        backgroundColor: '#ffffff',
        elements: [
          logo(brand.logoUrl, 40, 40),
          text({ content: 'RECIBO', x: 300, y: 44, width: 255, fontSize: 26, fontStyle: 'bold', fill: brand.primaryColor, align: 'right' }),
          rect({ x: 40, y: 110, width: 515, height: 150, fill: '#f8fafc', stroke: '#e2e8f0', strokeWidth: 1, cornerRadius: 12, name: 'Caixa' }),
          text({ content: 'Recebemos de ________________________________ a importância de\n£ __________ (______________________________________________)\nreferente a serviço de mudança / transporte realizado em ____/____/______.', x: 60, y: 130, width: 475, height: 100, fontSize: 12, fill: INK, lineHeight: 1.9 }),
          line(80, 340, 200, INK, 1),
          text({ content: `Assinatura ${brand.companyName}`, x: 80, y: 348, width: 200, fontSize: 9, fill: MUTED, align: 'center' }),
          line(320, 340, 200, INK, 1),
          text({ content: 'Assinatura do cliente', x: 320, y: 348, width: 200, fontSize: 9, fill: MUTED, align: 'center' }),
          text({ content: 'Londres, ____ de ______________ de 2026', x: 40, y: 400, width: 515, fontSize: 11, fill: '#334155', align: 'right' })
        ]
      };
    }
  },
  {
    id: 'checklist',
    name: 'Checklist de mudança',
    description: 'Lista de verificação para o cliente.',
    build: () => {
      const brand = getPdfBrandingAssets();
      const items = ['Confirmar data e horário', 'Separar documentos e objetos de valor', 'Etiquetar caixas por cômodo', 'Esvaziar e descongelar geladeira', 'Desmontar móveis grandes', 'Reservar vaga/estacionamento', 'Fotografar itens frágeis', 'Conferir inventário na entrega'];
      const els: EditorElement[] = [
        rect({ x: 0, y: 0, width: 595, height: 8, fill: brand.secondaryColor }),
        logo(brand.logoUrl, 40, 34),
        text({ content: 'Checklist da mudança', x: 40, y: 90, width: 515, fontSize: 24, fontStyle: 'bold', fill: brand.primaryColor }),
        text({ content: 'Marque cada item conforme for concluindo.', x: 40, y: 124, width: 515, fontSize: 11, fill: MUTED })
      ];
      items.forEach((label, i) => {
        const y = 170 + i * 44;
        els.push({ id: uid(), type: 'rect', content: '', x: 40, y, width: 22, height: 22, fill: '#ffffff', stroke: brand.primaryColor, strokeWidth: 1.5, cornerRadius: 5, name: `Caixa ${i + 1}` });
        els.push(text({ content: label, x: 74, y: y + 3, width: 480, fontSize: 13, fill: INK }));
        els.push(line(40, y + 34, 515, '#e2e8f0', 1));
      });
      return { id: uid(), ...A4, backgroundColor: '#ffffff', elements: els };
    }
  },
  {
    id: 'social',
    name: 'Post promocional',
    description: 'Quadrado 800×800 para redes sociais.',
    build: () => {
      const brand = getPdfBrandingAssets();
      return {
        id: uid(),
        width: 800,
        height: 800,
        backgroundColor: brand.primaryColor,
        elements: [
          rect({ x: 0, y: 640, width: 800, height: 160, fill: brand.secondaryColor }),
          text({ content: 'MUDANÇA SEM ESTRESSE', x: 60, y: 120, width: 680, fontSize: 56, fontStyle: 'bold', fill: '#ffffff', align: 'left', lineHeight: 1.05, height: 130 }),
          text({ content: 'Reino Unido · Europa · Brasil', x: 60, y: 280, width: 680, fontSize: 24, fill: '#c7d2fe' }),
          text({ content: 'Documentos prontos em minutos', x: 60, y: 330, width: 680, fontSize: 20, fill: '#ffffff' }),
          text({ content: '+44 20 0000 0000  ·  www.optafiles.com', x: 60, y: 690, width: 680, fontSize: 26, fontStyle: 'bold', fill: '#ffffff', align: 'center' })
        ]
      };
    }
  }
];
