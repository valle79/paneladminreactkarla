import * as XLSX from 'xlsx';
import { formatDocNumber } from '../config';

/* ============================================================
   Exportación masiva de ventas a Excel (basada en filtros).
   Genera dos hojas: "Ventas" (resumen) y "Detalle de items".
   ============================================================ */

export const SALE_SEARCH_KEYS = [
  (r) => (r.invoice_number ? String(r.invoice_number) : ''),
  (r) => r.invoice_type,
  (r) => r.client?.names || r.client?.razonsocial || '',
  (r) => r.client?.dni || r.client?.ruc || '',
  (r) => r.advisor?.name || '',
  (r) => (r.total ? String(r.total) : ''),
];

export function filterBySearch(rows, term) {
  const t = (term || '').trim().toLowerCase();
  if (!t) return rows;
  return (rows || []).filter((row) =>
    SALE_SEARCH_KEYS.some((k) => {
      const v = k(row);
      return v == null ? false : String(v).toLowerCase().includes(t);
    })
  );
}

/* ---- Mapeos y helpers de formato ---- */

const PAYMENT_LABEL = { pagado: 'CANCELADO', por_pagar: 'PENDIENTE', a_cuenta: 'PAGO PARCIAL' };
const ITEM_LABEL = { machine: 'Producto', repuesto: 'Repuesto', service: 'Servicio', manual: 'Item manual' };

const round2 = (n) => Number(Number(n || 0).toFixed(2));
const fmtDate = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const fmtDateTime = (iso) =>
  iso ? `${String(iso).slice(0, 10).split('-').reverse().join('/')} ${String(iso).slice(11, 16)}` : '';

const clientName = (s) => {
  const c = s.client || {};
  return c.names ? `${c.names} ${c.last_names || ''}`.trim() : c.razonsocial || '—';
};

const clientPhone = (s) => {
  const c = s.client || {};
  return s.client_type === 'ruc'
    ? (Array.isArray(c.telefonos) ? c.telefonos[0] : c.telefonos)
    : c.phone;
};

function paymentState(s) {
  const status = s.payment_status || 'por_pagar';
  const total = round2(s.total);
  if (status === 'pagado') {
    return { total, abonado: total, saldo: 0, fechaLimite: '' };
  }
  if (status === 'a_cuenta') {
    const abonado = round2(s.amount_paid);
    const saldo = s.amount_pending != null ? round2(s.amount_pending) : round2(total - abonado);
    return { total, abonado, saldo, fechaLimite: s.pending_payment_date || '' };
  }
  return { total, abonado: 0, saldo: total, fechaLimite: s.payment_date || '' };
}

/* ---- Fila de resumen (hoja "Ventas") ---- */

const VENTAS_HEADERS = [
  'Documento', 'Fecha', 'Cliente', 'Tipo de item', 'Item vendido', 'Tipo', 'DNI/RUC', 'Teléfono', 'Asesor',
  'Valor de venta', 'IGV', 'Descuento', 'Total', 'Estado de pago', 'Abonado', 'Saldo', 'Fecha límite',
];
const VENTAS_WIDTHS = [17, 17, 26, 14, 42, 8, 14, 15, 16, 14, 14, 13, 14, 17, 14, 13, 13];
const VENTAS_MONEY_COLS = [9, 10, 11, 12, 14, 15];

function saleTypesText(s) {
  return (s.items || []).map((it) => ITEM_LABEL[it.item_type] || it.item_type || 'Item').join('; ');
}

function saleNamesText(s) {
  return (s.items || [])
    .map((it) => {
      const q = Number(it.quantity || 0);
      const name = it.name || it.manual_name || 'Item';
      return `${name}${q && q !== 1 ? ` ×${q}` : ''}`;
    })
    .join('; ');
}

function toVentaRow(s) {
  const c = s.client || {};
  const pago = paymentState(s);
  return [
    formatDocNumber(s.invoice_type, s.invoice_number),
    fmtDateTime(s.created_at),
    clientName(s),
    saleTypesText(s),
    saleNamesText(s),
    s.client_type === 'ruc' ? 'RUC' : 'DNI',
    c.ruc || c.dni || '',
    clientPhone(s) || '',
    s.advisor?.name || '—',
    round2(s.subtotal),
    round2(s.igv),
    round2(s.discount_amount),
    pago.total,
    PAYMENT_LABEL[s.payment_status] || s.payment_status || '—',
    pago.abonado,
    pago.saldo,
    fmtDate(pago.fechaLimite),
  ];
}

/* ---- Fila de detalle (hoja "Detalle de items") ---- */

const DETALLE_HEADERS = [
  'Documento', 'Fecha', 'Cliente', 'Item', 'Tipo de item', 'Cantidad', 'P. unitario', 'Importe',
];
const DETALLE_WIDTHS = [17, 17, 28, 34, 13, 10, 14, 14];
const DETALLE_MONEY_COLS = [6, 7];
const DETALLE_QTY_COLS = [5];

function toDetalleRow(s) {
  return (s.items || []).map((it) => [
    formatDocNumber(s.invoice_type, s.invoice_number),
    fmtDateTime(s.created_at),
    clientName(s),
    it.name || it.manual_name || 'Item',
    ITEM_LABEL[it.item_type] || it.item_type || '—',
    Number(it.quantity || 0),
    round2(it.unit_price),
    round2(Number(it.quantity || 0) * Number(it.unit_price || 0)),
  ]);
}

/* ---- Construcción del libro ---- */

function makeSheet(headers, widths, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((_, i) => ({ wch: widths[i] || 12 }));
  ws['!autofilter'] = ws['!ref'] ? { ref: ws['!ref'] } : undefined;
  styleHeader(ws);
  return ws;
}

function styleHeader(sheet) {
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let c = 0; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    if (!cell) continue;
    cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '1F5E3F' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }
  sheet['!rows'] = [{ hpt: 22 }];
}

function applyNumberFormats(sheet, columns, format) {
  const range = XLSX.utils.decode_range(sheet['!ref']);
  columns.forEach((col) => {
    for (let r = 1; r <= range.e.r; r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: col })];
      if (cell && typeof cell.v === 'number') cell.z = format;
    }
  });
}

export function timestampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportSalesToExcel(sales) {
  const list = sales || [];
  if (list.length === 0) return 0;

  const wsVentas = makeSheet(VENTAS_HEADERS, VENTAS_WIDTHS, list.map(toVentaRow));
  applyNumberFormats(wsVentas, VENTAS_MONEY_COLS, '#,##0.00');

  const detalle = list.flatMap(toDetalleRow);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsVentas, 'Ventas');

  if (detalle.length > 0) {
    const wsDetalle = makeSheet(DETALLE_HEADERS, DETALLE_WIDTHS, detalle);
    applyNumberFormats(wsDetalle, DETALLE_MONEY_COLS, '#,##0.00');
    applyNumberFormats(wsDetalle, DETALLE_QTY_COLS, '#,##0.##');
    XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle de items');
  }

  XLSX.writeFile(wb, `ventas_${timestampName()}.xlsx`);
  return list.length;
}