/**
 * Which tools need an account. Same rule as ACCOUNT_ONLY in backend/auth/index.js —
 * the backend is the real gate; this only lets the UI ask before the upload starts.
 */
import type { PdfTool } from '../easypdf/tools';

const ACCOUNT_ONLY = [/^convert\/(?!pdf\/img$|img\/pdf$)/, /^misc\/ocr-pdf$/, /^misc\/extract-image-scans$/, /^security\/cert-sign$/, /^security\/auto-redact$/];

export const requiresAccount = (tool: Pick<PdfTool, 'endpoint'>) => Boolean(tool.endpoint) && ACCOUNT_ONLY.some((re) => re.test(tool.endpoint));
