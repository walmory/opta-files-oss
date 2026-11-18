import * as pdfjsLib from 'pdfjs-dist';

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

// Types for our elements
export type ElementType = 'text' | 'image' | 'rect' | 'line' | 'path';

export interface BaseElement {
  id?: string;
  type: ElementType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  role?: 'background' | 'container' | 'content' | 'watermark' | 'table' | 'structure';
}

export interface TextElement extends BaseElement {
  type: 'text';
  content: string;
  fontSize: number;
  fill: string;
  fontFamily?: string;
  lineHeight?: number;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string; // dataUrl
}

export interface RectElement extends BaseElement {
  type: 'rect';
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface LineElement extends BaseElement {
  type: 'line';
  points: number[]; // [x1, y1, x2, y2, ...]
  stroke: string;
  strokeWidth: number;
}

export interface PathElement extends BaseElement {
  type: 'path';
  data: string; // SVG path data
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export type ParsedElement = TextElement | ImageElement | RectElement | LineElement | PathElement;

export interface PdfImportResult {
  elements: ParsedElement[];
  pageWidth: number;
  pageHeight: number;
}

import { analyzeInvoiceLayout } from './aiLayoutService';

// --- Intelligent Processing Helpers ---

/**
 * Merges close text elements into lines/paragraphs
 */
const processTextElements = (elements: ParsedElement[]): ParsedElement[] => {
  const textElements = elements.filter(e => e.type === 'text') as TextElement[];
  const otherElements = elements.filter(e => e.type !== 'text');

  if (textElements.length === 0) return otherElements;

  // Sort by Y, then X
  textElements.sort((a, b) => {
    if (Math.abs(a.y - b.y) < 5) return a.x - b.x;
    return a.y - b.y;
  });

  const merged: TextElement[] = [];
  let current: TextElement | null = null;

  for (const el of textElements) {
    if (!current) {
      current = { ...el };
      continue;
    }

    // Check if on same line (approx) and close in X
    const sameLine = Math.abs(el.y - current.y) < (current.fontSize || 12) * 0.5;
    const closeX = (el.x - (current.x + (current.width || 0))) < 50; // Tolerance
    const sameStyle = el.fontSize === current.fontSize && el.fill === current.fill;

    if (sameLine && closeX && sameStyle) {
      // Merge
      const space = (el.x - (current.x + (current.width || 0))) > 5 ? ' ' : '';
      current.content += space + el.content;
      current.width = (current.width || 0) + (el.width || 0) + (space ? 4 : 0);
    } else {
      merged.push(current);
      current = { ...el };
    }
  }
  if (current) merged.push(current);

  return [...otherElements, ...merged];
};

/**
 * Identifies backgrounds, watermarks, and structure
 */
const classifyElements = (elements: ParsedElement[], pageWidth: number, pageHeight: number): ParsedElement[] => {
  return elements.map(el => {
    // 1. Detect Backgrounds
    const isLarge = (el.width || 0) > pageWidth * 0.9 && (el.height || 0) > pageHeight * 0.9;

    if (el.type === 'rect' || el.type === 'image' || el.type === 'path') {
      if (isLarge) {
        return { ...el, role: 'background' };
      }
    }

    // 2. Detect Watermarks (heuristic: large text, rotated, low opacity/grey)
    if (el.type === 'text' && (el.rotation || 0) !== 0) {
       if ((el.fontSize || 0) > 40) {
         return { ...el, role: 'watermark', opacity: 0.3 };
       }
    }

    // 3. Detect Structure/Divs (Rects that are not backgrounds but contain content?)
    // For now, let's mark filled rects as 'structure' if they are big enough
    if ((el.type === 'rect' || el.type === 'path') && el.fill && (el.width || 0) > 50 && (el.height || 0) > 20) {
        if (el.role !== 'background') {
            return { ...el, role: 'structure' };
        }
    }

    return { ...el, role: 'content' };
  });
};


export const parsePdfToEditor = async (file: File): Promise<PdfImportResult> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  
  // We use scale 1.0 for logical coordinates.
  const viewport = page.getViewport({ scale: 1.0 });
  const { width, height } = viewport;

  const elements: ParsedElement[] = [];

  // Generate Image for AI Analysis
  const canvas = document.createElement('canvas');
  const scale = 2.0;
  const viewportHighRes = page.getViewport({ scale });
  canvas.width = viewportHighRes.width;
  canvas.height = viewportHighRes.height;
  const context = canvas.getContext('2d');
  
  let base64Image = '';
  if (context) {
      await page.render({ canvasContext: context, canvas, viewport: viewportHighRes }).promise;
      base64Image = canvas.toDataURL('image/jpeg');
  }

  // 1. Extract Text
  const textContent = await page.getTextContent();
  for (const item of textContent.items) {
    if ('str' in item) {
        const tx = item.transform; 
        const pdfX = tx[4];
        const pdfY = tx[5];
        const [x, y] = viewport.convertToViewportPoint(pdfX, pdfY);
        const fontSize = Math.abs(tx[3]);
        
        if (item.str.trim().length > 0) {
            elements.push({
                type: 'text',
                content: item.str,
                x: x,
                y: y - fontSize, 
                fontSize: fontSize,
                fill: '#000000',
                width: item.width,
                height: item.height
            });
        }
    }
  }

  // AI Analysis (Always Hybrid for Structure)
  // We ALWAYS attempt AI analysis for visual structure, merging with vectors.
  if (base64Image) {
      console.log("Triggering Hybrid AI analysis for visual structure...");
      try {
          const aiElements = await analyzeInvoiceLayout(base64Image);
          // Merge AI elements (Prioritize Structure)
          aiElements.forEach(aiEl => {
              // Add detected background containers (rects) if they don't overlap with existing ones?
              // For now, let's add them as 'structure' role.
              
              if (aiEl.type === 'rect') {
                  elements.push({
                      type: 'rect',
                      x: aiEl.x,
                      y: aiEl.y,
                      width: aiEl.width,
                      height: aiEl.height,
                      fill: aiEl.backgroundColor || '#f3f4f6',
                      role: 'structure', // AI detected structure
                      opacity: 0.5 // Slight transparency for AI inferred blocks
                  });
              } else if (aiEl.type === 'divider') {
                   // Add AI detected dividers
                   elements.push({
                       type: 'line',
                       points: [aiEl.x, aiEl.y, aiEl.x + aiEl.width, aiEl.y], // Horizontal line assumption for now
                       stroke: aiEl.fontColor || '#000',
                       strokeWidth: 1,
                       x: aiEl.x,
                       y: aiEl.y,
                       width: aiEl.width,
                       height: 1
                   });
              }
              // We skip 'text' from AI if we already have vectors, to avoid duplication/blurriness.
              // UNLESS we have very few text elements.
              else if (aiEl.type === 'text' && elements.filter(e => e.type === 'text').length < 10) {
                  elements.push({
                      type: 'text',
                      content: aiEl.content,
                      x: aiEl.x,
                      y: aiEl.y,
                      fontSize: aiEl.fontSize || 12,
                      fill: aiEl.fontColor || '#000000',
                      width: aiEl.width,
                      height: aiEl.height
                  });
              }
          });
      } catch (e) {
          console.warn("AI Analysis failed:", e);
      }
  }

  // 2. Extract Graphics (Images, Shapes)
  const opList = await page.getOperatorList();
  
  // Helper to get image data
  const getImageDataUrl = async (imgName: string): Promise<string | null> => {
      try {
          // Internal property access safely casted
          const commonObjs = (page as unknown as { objs: { get: (name: string) => Promise<unknown> } }).objs;
          const img = await commonObjs.get(imgName) as { width: number; height: number; bitmap?: ImageBitmap; data?: Uint8ClampedArray };
          if (!img) return null;
          
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;

          if (img.bitmap) {
               ctx.drawImage(img.bitmap, 0, 0);
          } else if (img.data) {
              const imageData = ctx.createImageData(img.width, img.height);
              if (img.data.length === img.width * img.height * 4) {
                   imageData.data.set(img.data);
              } else if (img.data.length === img.width * img.height * 3) {
                   // RGB to RGBA
                   for (let i = 0, j = 0; i < img.data.length; i += 3, j += 4) {
                       imageData.data[j] = img.data[i];     
                       imageData.data[j + 1] = img.data[i + 1]; 
                       imageData.data[j + 2] = img.data[i + 2]; 
                       imageData.data[j + 3] = 255;         
                   }
              }
              // TODO: Handle Grayscale (1 channel) and CMYK (4 channels) properly
              ctx.putImageData(imageData, 0, 0);
          }
          return canvas.toDataURL();
      } catch (e) {
          console.error("Error extracting image", e);
          return null;
      }
  };

  // Color State
  let currentFillColor = '#000000';
  let currentStrokeColor = '#000000';
  let currentFillAlpha = 1;
  let currentStrokeAlpha = 1;
  let currentLineWidth = 1;
  
  // Graphic State Interface
  interface GraphicState {
      transform: number[];
      fillColor: string;
      strokeColor: string;
      lineWidth: number;
      fillAlpha: number;
      strokeAlpha: number;
  }
  
  const transformStack: GraphicState[] = []; // Store transform & graphic state
  let currentTransform = [1, 0, 0, 1, 0, 0]; 
  
  // Helper to normalize colors (RGB, CMYK, Gray)
  const normalizeColor = (args: number[]): string => {
      try {
          if (!args || args.length === 0) return '#000000';

          // Grayscale (1 arg)
          if (args.length === 1) {
              const v = Math.round(args[0] * 255);
              return `rgb(${v}, ${v}, ${v})`;
          }
          
          // RGB (3 args)
          if (args.length === 3) {
              let [r, g, b] = args;
              // Check if normalized 0-1 (common in PDF) or 0-255
              // If all are <= 1.0, treat as float 0-1
              if (r <= 1 && g <= 1 && b <= 1) {
                  r *= 255; g *= 255; b *= 255;
              }
              return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
          }

          // CMYK (4 args)
          if (args.length === 4) {
              const c = args[0];
              const m = args[1];
              const y = args[2];
              const k = args[3];
              
              const r = 255 * (1 - c) * (1 - k);
              const g = 255 * (1 - m) * (1 - k);
              const b = 255 * (1 - y) * (1 - k);
              return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
          }
      } catch (e) {
          console.warn("Error normalizing color", args, e);
      }
      return '#000000';
  };

  // Path Construction State
  interface PathOp {
      op: string; // 'M', 'L', 'C', 'Z', 'Rect'
      args: number[];
  }
  let currentPathOps: PathOp[] = [];

  // Transform helper
  const transformPoint = (x: number, y: number, m: number[]) => {
      return {
          x: m[0] * x + m[2] * y + m[4],
          y: m[1] * x + m[3] * y + m[5]
      };
  };

  const applyTransformToPath = (ops: PathOp[], transform: number[]): string => {
      let d = '';
      for (const cmd of ops) {
          if (cmd.op === 'Rect') {
               const x = cmd.args[0], y = cmd.args[1], w = cmd.args[2], h = cmd.args[3];
               // Rect becomes Polygon
               const p1 = transformPoint(x, y, transform);
               const p2 = transformPoint(x+w, y, transform);
               const p3 = transformPoint(x+w, y+h, transform);
               const p4 = transformPoint(x, y+h, transform);
               
               const vp1 = viewport.convertToViewportPoint(p1.x, p1.y);
               const vp2 = viewport.convertToViewportPoint(p2.x, p2.y);
               const vp3 = viewport.convertToViewportPoint(p3.x, p3.y);
               const vp4 = viewport.convertToViewportPoint(p4.x, p4.y);
               
               d += `M ${vp1[0]} ${vp1[1]} L ${vp2[0]} ${vp2[1]} L ${vp3[0]} ${vp3[1]} L ${vp4[0]} ${vp4[1]} Z `;
          } else {
              // Standard SVG commands
              // We need to transform each point
              // M x y -> transform(x,y) -> viewport(x,y)
              const args = [...cmd.args];
              for(let i=0; i<args.length; i+=2) {
                  const p = transformPoint(args[i], args[i+1], transform);
                  const vp = viewport.convertToViewportPoint(p.x, p.y);
                  args[i] = vp[0];
                  args[i+1] = vp[1];
              }
              d += `${cmd.op} ${args.join(' ')} `;
          }
      }
      return d;
  };

  const calculatePathBBox = (ops: PathOp[], transform: number[]) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      
      const updateBounds = (x: number, y: number) => {
          const p = transformPoint(x, y, transform);
          const vp = viewport.convertToViewportPoint(p.x, p.y);
          // Viewport y is inverted relative to PDF usually, but convertToViewportPoint handles it.
          // Note: convertToViewportPoint returns [x, y]
          if (vp[0] < minX) minX = vp[0];
          if (vp[0] > maxX) maxX = vp[0];
          if (vp[1] < minY) minY = vp[1];
          if (vp[1] > maxY) maxY = vp[1];
      };

      for (const cmd of ops) {
          if (cmd.op === 'Rect') {
               // Test all 4 corners
               updateBounds(cmd.args[0], cmd.args[1]);
               updateBounds(cmd.args[0] + cmd.args[2], cmd.args[1]);
               updateBounds(cmd.args[0], cmd.args[1] + cmd.args[3]);
               updateBounds(cmd.args[0] + cmd.args[2], cmd.args[1] + cmd.args[3]);
          } else {
               for(let i=0; i<cmd.args.length; i+=2) {
                   updateBounds(cmd.args[i], cmd.args[i+1]);
               }
          }
      }
      
      if (minX === Infinity) return null;
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };

  // --- Recursive Operator Processor ---
  const processOperators = async (fnArray: number[], argsArray: unknown[]) => {
    for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = argsArray[i] as any[];

        switch (fn) {
            case pdfjsLib.OPS.save:
                transformStack.push({
                    transform: [...currentTransform],
                    fillColor: currentFillColor,
                    strokeColor: currentStrokeColor,
                    lineWidth: currentLineWidth,
                    fillAlpha: currentFillAlpha,
                    strokeAlpha: currentStrokeAlpha
                });
                break;
            case pdfjsLib.OPS.restore:
                if (transformStack.length > 0) {
                    const state = transformStack.pop();
                    if (state) {
                        currentTransform = state.transform;
                        currentFillColor = state.fillColor;
                        currentStrokeColor = state.strokeColor;
                        currentLineWidth = state.lineWidth;
                        currentFillAlpha = state.fillAlpha;
                        currentStrokeAlpha = state.strokeAlpha;
                    }
                }
                break;
            case pdfjsLib.OPS.transform: {
                const [a1, b1, c1, d1, e1, f1] = currentTransform;
                const [a2, b2, c2, d2, e2, f2] = args;
                currentTransform = [
                    a1 * a2 + c1 * b2,
                    b1 * a2 + d1 * b2,
                    a1 * c2 + c1 * d2,
                    b1 * c2 + d1 * d2,
                    a1 * e2 + c1 * f2 + e1,
                    b1 * e2 + d1 * f2 + f1
                ];
                break;
            }
                
            case pdfjsLib.OPS.setFillRGBColor:
            case pdfjsLib.OPS.setFillColor:
            case pdfjsLib.OPS.setFillColorN:
                currentFillColor = normalizeColor(args);
                break;
            
            case pdfjsLib.OPS.setStrokeRGBColor:
            case pdfjsLib.OPS.setStrokeColor:
            case pdfjsLib.OPS.setStrokeColorN:
                currentStrokeColor = normalizeColor(args);
                break;
                
            case pdfjsLib.OPS.setLineWidth:
                currentLineWidth = args[0];
                break;
            
            // --- Path Construction ---
            case pdfjsLib.OPS.rectangle: {
                 const x = args[0], y = args[1], w = args[2], h = args[3];
                 currentPathOps.push({ op: 'Rect', args: [x, y, w, h] });
                 break;
            }

            case pdfjsLib.OPS.constructPath: {
                const ops = args[0];
                const vals = args[1];
                let valIdx = 0;
                
                for (let j = 0; j < ops.length; j++) {
                    const op = ops[j];
                    if (op === pdfjsLib.OPS.rectangle) {
                        const x = vals[valIdx++], y = vals[valIdx++], w = vals[valIdx++], h = vals[valIdx++];
                        currentPathOps.push({ op: 'Rect', args: [x, y, w, h] });
                    } else if (op === pdfjsLib.OPS.moveTo) {
                        currentPathOps.push({ op: 'M', args: [vals[valIdx++], vals[valIdx++]] });
                    } else if (op === pdfjsLib.OPS.lineTo) {
                        currentPathOps.push({ op: 'L', args: [vals[valIdx++], vals[valIdx++]] });
                    } else if (op === pdfjsLib.OPS.curveTo) {
                        currentPathOps.push({ op: 'C', args: [vals[valIdx++], vals[valIdx++], vals[valIdx++], vals[valIdx++], vals[valIdx++], vals[valIdx++]] });
                    } else if (op === 21) { // 21 is usually closePath in PDF.js OPS enum if not exposed
                         // Fallback for close if not exposed on OPS
                          currentPathOps.push({ op: 'Z', args: [] });
                     } else if ('close' in pdfjsLib.OPS && op === (pdfjsLib.OPS as unknown as Record<string, number>).close) { // if it exists
                         currentPathOps.push({ op: 'Z', args: [] });
                     }
                }
                break;
            }
                
            // --- Path Painting ---
            case pdfjsLib.OPS.fill:
            case pdfjsLib.OPS.eoFill: {
                if (currentPathOps.length > 0) {
                    const d = applyTransformToPath(currentPathOps, currentTransform);
                    const bbox = calculatePathBBox(currentPathOps, currentTransform);
                    elements.push({
                        type: 'path',
                        data: d,
                        fill: currentFillColor,
                        stroke: undefined, 
                        strokeWidth: 0,
                        x: 0, y: 0,
                        width: bbox?.width,
                        height: bbox?.height,
                        opacity: currentFillAlpha
                    });
                    currentPathOps = []; 
                }
                break;
            }
                
            case pdfjsLib.OPS.stroke: {
                if (currentPathOps.length > 0) {
                    const d = applyTransformToPath(currentPathOps, currentTransform);
                    const bbox = calculatePathBBox(currentPathOps, currentTransform);
                    elements.push({
                        type: 'path',
                        data: d,
                        fill: undefined,
                        stroke: currentStrokeColor,
                        strokeWidth: currentLineWidth,
                        x: 0, y: 0,
                        width: bbox?.width,
                        height: bbox?.height,
                        opacity: currentStrokeAlpha
                    });
                    currentPathOps = [];
                }
                break;
            }

            // Combined Fill & Stroke Operations (Fix for missing "divs"/shapes)
            case pdfjsLib.OPS.fillStroke:
            case pdfjsLib.OPS.eoFillStroke: {
                if (currentPathOps.length > 0) {
                    const d = applyTransformToPath(currentPathOps, currentTransform);
                    const bbox = calculatePathBBox(currentPathOps, currentTransform);
                    elements.push({
                        type: 'path',
                        data: d,
                        fill: currentFillColor,
                        stroke: currentStrokeColor,
                        strokeWidth: currentLineWidth,
                        x: 0, y: 0,
                        width: bbox?.width,
                        height: bbox?.height,
                        opacity: currentFillAlpha
                    });
                    currentPathOps = [];
                }
                break;
            }

            case pdfjsLib.OPS.closeStroke: {
                currentPathOps.push({ op: 'Z', args: [] });
                if (currentPathOps.length > 0) {
                    const d = applyTransformToPath(currentPathOps, currentTransform);
                    const bbox = calculatePathBBox(currentPathOps, currentTransform);
                    elements.push({
                        type: 'path',
                        data: d,
                        fill: undefined,
                        stroke: currentStrokeColor,
                        strokeWidth: currentLineWidth,
                        x: 0, y: 0,
                        width: bbox?.width,
                        height: bbox?.height,
                        opacity: currentStrokeAlpha
                    });
                    currentPathOps = [];
                }
                break;
            }

            case pdfjsLib.OPS.closeFillStroke: {
                currentPathOps.push({ op: 'Z', args: [] });
                if (currentPathOps.length > 0) {
                    const d = applyTransformToPath(currentPathOps, currentTransform);
                    const bbox = calculatePathBBox(currentPathOps, currentTransform);
                    elements.push({
                        type: 'path',
                        data: d,
                        fill: currentFillColor,
                        stroke: currentStrokeColor,
                        strokeWidth: currentLineWidth,
                        x: 0, y: 0,
                        width: bbox?.width,
                        height: bbox?.height,
                        opacity: currentFillAlpha
                    });
                    currentPathOps = [];
                }
                break;
            }

            case pdfjsLib.OPS.closeEOFillStroke: {
              currentPathOps.push({ op: 'Z', args: [] });
              if (currentPathOps.length > 0) {
                  const d = applyTransformToPath(currentPathOps, currentTransform);
                  const bbox = calculatePathBBox(currentPathOps, currentTransform);
                  elements.push({
                      type: 'path',
                      data: d,
                      fill: currentFillColor,
                      stroke: currentStrokeColor,
                      strokeWidth: currentLineWidth,
                      x: 0, y: 0,
                      width: bbox?.width,
                      height: bbox?.height,
                      opacity: currentFillAlpha
                  });
                  currentPathOps = [];
              }
              break;
          }

          // @ts-expect-error - fallback for casing
          case pdfjsLib.OPS.closeEoFillStroke: {
              currentPathOps.push({ op: 'Z', args: [] });
              if (currentPathOps.length > 0) {
                  const d = applyTransformToPath(currentPathOps, currentTransform);
                  const bbox = calculatePathBBox(currentPathOps, currentTransform);
                  elements.push({
                      type: 'path',
                      data: d,
                      fill: currentFillColor,
                      stroke: currentStrokeColor,
                      strokeWidth: currentLineWidth,
                      x: 0, y: 0,
                      width: bbox?.width,
                      height: bbox?.height,
                      opacity: currentFillAlpha
                  });
                  currentPathOps = [];
              }
              break;
          }
                
            // Image
            case pdfjsLib.OPS.paintImageXObject:
            case pdfjsLib.OPS.paintInlineImageXObject: {
                const imgName = args[0];
                const dataUrl = await getImageDataUrl(imgName);
                if (dataUrl) {
                    const p2 = transformPoint(0, 1, currentTransform); // Top-Left in PDF (0,1)
                    const p0 = transformPoint(0, 0, currentTransform); // Bottom-Left
                    const p1 = transformPoint(1, 0, currentTransform); // Bottom-Right
                    
                    const vp2 = viewport.convertToViewportPoint(p2.x, p2.y);
                    const vp0 = viewport.convertToViewportPoint(p0.x, p0.y);
                    const vp1 = viewport.convertToViewportPoint(p1.x, p1.y);
                    
                    const w = Math.hypot(vp1[0] - vp0[0], vp1[1] - vp0[1]);
                    const h = Math.hypot(vp2[0] - vp0[0], vp2[1] - vp0[1]);
                    
                    elements.push({
                        type: 'image',
                        src: dataUrl,
                        x: vp2[0], 
                        y: vp2[1],
                        width: w,
                        height: h,
                    });
                }
                break;
            }

            // Form XObject (Recursive)
            case pdfjsLib.OPS.paintXObject: {
                const name = args[0];
                 try {
                     // Internal property access safely casted
                     const commonObjs = (page as unknown as { objs: { get: (name: string) => Promise<unknown> } }).objs;
                     const xobj = await commonObjs.get(name) as { operatorList?: { fnArray: number[], argsArray: unknown[] } };
                     
                     if (xobj && xobj.operatorList) {
                         // Save state before recursion
                         transformStack.push({
                             transform: [...currentTransform],
                             fillColor: currentFillColor,
                             strokeColor: currentStrokeColor,
                             lineWidth: currentLineWidth,
                             fillAlpha: currentFillAlpha,
                             strokeAlpha: currentStrokeAlpha
                         });

                         // Process Form XObject
                         // Need to check if it has a matrix (transform)
                         // But usually getOperatorList already handles this or we need to apply it?
                         // Actually, paintXObject usually doesn't have args for matrix, the matrix is in the XObject dict?
                         // Wait, pdf.js operatorList for XObject is usually raw ops.
                         // We might need to recursively call processOperators with xobj.operatorList.fnArray and argsArray
                         
                         await processOperators(xobj.operatorList.fnArray, xobj.operatorList.argsArray);

                         // Restore state
                         if (transformStack.length > 0) {
                            const state = transformStack.pop();
                            if (state) {
                                currentTransform = state.transform;
                                currentFillColor = state.fillColor;
                                currentStrokeColor = state.strokeColor;
                                currentLineWidth = state.lineWidth;
                                currentFillAlpha = state.fillAlpha;
                                currentStrokeAlpha = state.strokeAlpha;
                            }
                         }
                     }
                 } catch (e) {
                     console.warn("Error processing XObject", name, e);
                 }
                 break;
            }
        }
    }
  };

  await processOperators(opList.fnArray, opList.argsArray);

  // --- Post Processing ---
  let finalElements = processTextElements(elements);
  finalElements = classifyElements(finalElements, width, height);

  return {
    elements: finalElements,
    pageWidth: width,
    pageHeight: height
  };
};
