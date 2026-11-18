import * as pdfjsLib from 'pdfjs-dist';
// The worker is bundled from the installed package so its version always matches
// the API version (a mismatch makes pdf.js throw UnknownErrorException on every load).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export const PDFLib = pdfjsLib;
