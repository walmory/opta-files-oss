import { PDFLib } from '../utils/pdfWorker';

export interface PdfPage {
  imageUrl: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

export const renderPdfToImages = async (file: File): Promise<{ pages: PdfPage[], pdfBytes: ArrayBuffer }> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await PDFLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const pages: PdfPage[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    // Viewport original (escala 1.0) para obter dimensões lógicas
    const originalViewport = page.getViewport({ scale: 1.0 });

    // Viewport de alta qualidade para renderização (escala 2.0)
    const scale = 2.0;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (context) {
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        
        pages.push({
            imageUrl: canvas.toDataURL('image/jpeg', 0.8),
            width: originalViewport.width,
            height: originalViewport.height,
            originalWidth: originalViewport.width,
            originalHeight: originalViewport.height
        });
    }
  }

  return {
    pages,
    pdfBytes: arrayBuffer
  };
};

// Deprecated: Kept for backward compatibility if needed, but redirects to single page of above
export const renderPdfToImage = async (file: File): Promise<{ imageUrl: string, pdfBytes: ArrayBuffer, width: number, height: number }> => {
    const { pages, pdfBytes } = await renderPdfToImages(file);
    if (pages.length === 0) throw new Error("No pages found");
    return {
        imageUrl: pages[0].imageUrl,
        pdfBytes,
        width: pages[0].width,
        height: pages[0].height
    };
};
