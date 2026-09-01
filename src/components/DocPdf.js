import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

/* ============================================================
   Genera un PDF A4 real a partir del documento impreso del panel,
   con paginación dinámica (encabezado/pie en el DOM se repiten).
   ============================================================ */

const A4_W = 210; // mm
const A4_H = 297; // mm
// Relación de aspecto A4 (alto = ancho * A4_H/A4_W) para calcular bandas.
const A4_RATIO = A4_H / A4_W;

async function capture(el) {
  return html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    imageTimeout: 20000,
  });
}

/* Divide un canvas alto en bandas con la proporción A4 (pag. dinámica). */
function slicePages(canvas) {
  const pages = [];
  const w = canvas.width;
  const h = canvas.height;
  const pageH = Math.round(w * A4_RATIO);
  const count = Math.max(1, Math.ceil(h / pageH));
  for (let i = 0; i < count; i++) {
    const y = i * pageH;
    const height = Math.min(pageH, h - y);
    if (height <= 0) break;
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = w;
    pageCanvas.height = height;
    const ctx = pageCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    ctx.drawImage(canvas, 0, y, w, height, 0, 0, w, height);
    pages.push(pageCanvas);
  }
  return pages.length ? pages : [canvas];
}

function addPageImage(pdf, page) {
  const pw = page.width;
  const ph = page.height;
  let w = A4_W - 8;
  let h = (ph * w) / pw;
  if (h > A4_H - 8) {
    const f = (A4_H - 8) / h;
    w *= f;
    h = A4_H - 8;
  }
  pdf.addImage(page.toDataURL('image/jpeg', 0.93), 'JPEG', (A4_W - w) / 2, (A4_H - h) / 2, w, h);
}

export async function buildDocumentPdfBlob(mainEl, photosEl) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  const mainPages = slicePages(await capture(mainEl));
  const photoPages = photosEl ? slicePages(await capture(photosEl)) : [];

  const totalPages = mainPages.length + photoPages.length;

  const addAll = (sourcePages, firstIndex) => {
    sourcePages.forEach((page, i) => {
      const pageNum = firstIndex + i;
      if (pageNum > 0) pdf.addPage();
      addPageImage(pdf, page);
    });
  };

  addAll(mainPages, 0);
  addAll(photoPages, mainPages.length);

  if (totalPages === 0) {
    pdf.addPage();
  }

  return pdf.output('blob');
}
