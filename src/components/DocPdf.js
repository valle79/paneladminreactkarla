import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

/* ============================================================
   Genera un PDF A4 real a partir del documento impreso del panel
   (misma presentación que "Imprimir / PDF", pero como archivo).
   ============================================================ */

const A4_W = 210; // mm
const A4_H = 297; // mm

async function capture(el) {
  return html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    imageTimeout: 20000,
  });
}

function fitPage(pdf, canvas) {
  const pw = canvas.width;
  const ph = canvas.height;
  let w = A4_W;
  let h = (ph * A4_W) / pw;
  if (h > A4_H) {
    const f = A4_H / h;
    w *= f;
    h = A4_H;
  }
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', (A4_W - w) / 2, 0, w, h);
}

export async function buildDocumentPdfBlob(mainEl, photosEl) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  fitPage(pdf, await capture(mainEl));
  if (photosEl) {
    pdf.addPage();
    fitPage(pdf, await capture(photosEl));
  }
  return pdf.output('blob');
}