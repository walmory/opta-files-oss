import { ENV } from '../config/env';
import { GoogleGenerativeAI } from '@google/generative-ai';

// API Key reused from existing configuration
const GEMINI_API_KEY = ENV.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

export interface PDFElement {
  id: string;
  type: 'text' | 'image' | 'table' | 'rect' | 'divider' | 'signature_area' | 'container_box';
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  fontWeight?: 'bold' | 'normal';
  fontColor?: string;
  align?: 'left' | 'center' | 'right';
  backgroundColor?: string;
  role?: 'background' | 'container' | 'content';
  style?: React.CSSProperties; // Add style for compatibility with EasyPDF
  label?: string; // Add label for compatibility with EasyPDF
}

export const extractLayoutFromImage = async (base64Image: string): Promise<PDFElement[]> => {
  return analyzeInvoiceLayout(base64Image);
}

export const analyzeInvoiceLayout = async (base64Image: string): Promise<PDFElement[]> => {
  try {
    // Using gemini-2.5-flash as strictly requested by user (cheaper & faster)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Remove data:image/...;base64, prefix if present
    const base64Data = base64Image.split(',')[1] || base64Image;

    // Detect mime type if possible, default to jpeg
    let mimeType = 'image/jpeg';
    if (base64Image.startsWith('data:image/png')) {
      mimeType = 'image/png';
    } else if (base64Image.startsWith('data:image/webp')) {
      mimeType = 'image/webp';
    } else if (base64Image.startsWith('data:application/pdf')) {
       mimeType = 'application/pdf';
    }

    const prompt = `Aja como um motor de OCR e Análise de Layout de Documentos.
    Analise a imagem fornecida (uma folha A4: 595x842 pixels).
    Identifique e categorize cada elemento visual para reconstruir um template editável.

    **RETORNE APENAS UM JSON ARRAY COM ESTA ESTRUTURA:**
    {
      "elements": [
        {
          "type": "text" | "image" | "signature_area" | "container_box",
          "content": "string do texto ou url placeholder",
          "x": number (0-595),
          "y": number (0-842),
          "width": number,
          "height": number,
          "fontSize": number (apenas para texto, estime visualmente),
          "fontWeight": "bold" | "normal",
          "label": "ex: Logo da Empresa, Assinatura do Cliente" (para contexto)
        }
      ]
    }

    **REGRAS DE DETECÇÃO:**
    1. Se vir um Logotipo: type='image', content='https://placehold.co/100x50?text=LOGO', label='Logo'.
    2. Se vir uma linha de assinatura: type='signature_area', desenhe um box ao redor.
    3. Se vir um bloco de cor de fundo (div): type='container_box'.
    4. Agrupe textos próximos que formam parágrafos.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text();

    // Clean up response (remove markdown code blocks if any)
    const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
      const parsed = JSON.parse(jsonString);
      const elements = parsed.elements || parsed; // Handle { elements: [] } or []
      
      // Post-processing to match EasyPDF internal structure (Free Canvas Layout)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return elements.map((el: any) => ({
        ...el,
        label: el.label || el.type.charAt(0).toUpperCase() + el.type.slice(1),
        style: {
          position: 'absolute',
          left: `${el.x}px`,
          top: `${el.y}px`,
          width: el.width ? `${el.width}px` : undefined,
          height: el.height ? `${el.height}px` : undefined,
          fontSize: el.fontSize ? `${el.fontSize}px` : undefined,
          fontWeight: el.fontWeight,
          color: el.fontColor || '#000000',
          textAlign: el.align,
          backgroundColor: el.backgroundColor || 'transparent',
        }
      }));

    } catch (parseError) {
      console.error('Failed to parse Gemini response:', text, parseError);
      throw new Error('Falha ao interpretar resposta da IA.');
    }

  } catch (error) {
    console.error('Error analyzing invoice layout:', error);
    throw error;
  }
};
