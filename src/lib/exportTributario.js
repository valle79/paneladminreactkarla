import * as XLSX from 'xlsx';
import { downloadBlob, timestampName } from './exportSales';

/* ============================================================
   Exportación a Excel del Resumen Tributario.
   Dos hojas: "Resumen" (tarjetas/detalle) y "Detalle mensual".
   ============================================================ */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const round2 = (n) => Number(Number(n || 0).toFixed(2));
const money = (n) => round2(n);

const REGIMEN_LABEL = {
  RMT: 'Régimen MYPE Tributario (RMT)',
  GENERAL: 'Régimen General',
  NRUS: 'Nuevo RUS (NRUS)',
};

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

function makeSheet(headers, widths, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((_, i) => ({ wch: widths[i] || 12 }));
  ws['!autofilter'] = ws['!ref'] ? { ref: ws['!ref'] } : undefined;
  styleHeader(ws);
  return ws;
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

const RESUMEN_WIDTHS = [42, 18];

function detalleRows(detalleIgv, detalleIr, resumen, regimenLabel) {
  return [
    ['DETALLE DEL IGV', ''],
    ['IGV de ventas (FACTURAS + BOLETAS)', money(detalleIgv.igv_ventas)],
    ['IGV de compras (crédito fiscal, solo FACTURAS)', money(detalleIgv.igv_compras)],
    ['IGV por pagar', money(detalleIgv.igv_por_pagar)],
    ['Saldo a favor', money(detalleIgv.saldo_a_favor)],
    [],
    ['PAGO A CUENTA DEL IR', ''],
    [regimenLabel, ''],
    ['Ingresos netos (base)', money(detalleIr.ingresos_netos)],
    [`Tasa ${Number(detalleIr.tasa) * 100}%`, ''],
    ['Pago a cuenta del IR', money(detalleIr.pago_cuenta)],
    [],
    ['TOTAL REFERENCIAL (IGV + IR)', money(resumen.total_referencial)],
  ];
}

export function exportTributarioToExcel(data, { anio, mes }) {
  const { detalle_igv, detalle_ir, resumen, config } = data || {};
  if (!resumen) return;

  const regimenLabel = REGIMEN_LABEL[config?.ir_regime] || `Régimen ${config?.ir_regime || 'RMT'}`;
  const periodo = mes
    ? `${MESES[mes - 1]} ${anio}`
    : `${anio} (todos los meses)`;

  const wsResumen = XLSX.utils.aoa_to_sheet([
    ['RESUMEN TRIBUTARIO', `Período: ${periodo}`],
    ...detalleRows(detalle_igv, detalle_ir, resumen, regimenLabel),
  ]);
  wsResumen['!cols'] = RESUMEN_HEADERS.map((_, i) => ({ wch: RESUMEN_WIDTHS[i] || 12 }));

  const DETALLE_HEADERS = ['Mes', 'Ventas (S/)', 'IGV ventas', 'Compras (S/)', 'IGV compras', 'IGV por pagar', 'Pago a cuenta IR', 'Total referencial'];
  const DETALLE_WIDTHS = [20, 16, 14, 16, 14, 14, 16, 16];
  const DETALLE_MONEY_COLS = [1, 2, 3, 4, 5, 6, 7];

  const filasMensuales = (data.annual || []).filter((x) => (mes ? x.mes === `${anio}-${String(mes).padStart(2, '0')}` : true));
  const wsDetalle = makeSheet(
    DETALLE_HEADERS,
    DETALLE_WIDTHS,
    filasMensuales.map((x) => [
      MESES[Number(x.mes.split('-')[1]) - 1],
      money(x.ventas_total),
      money(x.ventas_igv),
      money(x.compras_total),
      money(x.compras_igv),
      money(x.igv_por_pagar),
      money(x.ir_pago_cuenta),
      money(x.total_referencial),
    ])
  );
  applyNumberFormats(wsDetalle, DETALLE_MONEY_COLS, '#,##0.00');

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');
  XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle mensual');

  const sufijo = mes ? `${String(mes).padStart(2, '0')}` : 'ANUAL';
  const blob = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([blob]), `resumen_tributario_${anio}_${sufijo}_${timestampName()}.xlsx`);
}

export { downloadBlob, timestampName };