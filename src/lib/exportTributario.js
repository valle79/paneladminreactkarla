import * as XLSX from 'xlsx';
import { downloadBlob, timestampName } from './exportSales';

/* ============================================================
   Exportación a Excel del Resumen Tributario.
   Hojas: "Resumen" (IGV + IR del período y declaración anual),
   "Detalle mensual" y "Gastos deducibles".
   ============================================================ */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const round2 = (n) => Number(Number(n || 0).toFixed(2));
const money = (n) => round2(n);

const REGIMEN_LABEL = {
  RMT: 'Régimen MYPE Tributario (RMT)',
  GENERAL: 'Régimen General',
  NRUS: 'Nuevo RUS (NRUS)',
};

const CATEGORIA_LABEL = {
  COMPRA_MERCADERIA: 'Compra de mercadería',
  SERVICIOS: 'Servicios',
  ALQUILER: 'Alquiler',
  TRANSPORTE: 'Transporte',
  SERVICIOS_PROFESIONALES: 'Servicios profesionales',
  GASTOS_BANCARIOS: 'Gastos bancarios',
  OTROS_GASTOS: 'Otros gastos',
};

const RESUMEN_HEADERS = ['Concepto', 'Importe'];
const RESUMEN_WIDTHS = [46, 18];
const RESUMEN_MONEY_COLS = [1];

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

function detalleRows({ detalleIgv, detalleIr, irAnual, resumen, config, regimenLabel, gastosDetalle }) {
  const tiposVentas = (config?.ventas_igv_tipos || ['FACTURA', 'BOLETA']).join(' y ');
  const tiposCompras = (config?.compras_igv_tipos || ['FACTURA']).join(', ');
  const filas = [
    ['DETALLE DEL IGV', ''],
    [`IGV de ventas (${tiposVentas}, estado fiscal válido)`, money(detalleIgv?.igv_ventas)],
    [`IGV de compras (crédito fiscal: ${tiposCompras})`, money(detalleIgv?.igv_compras)],
    ['IGV por pagar', money(detalleIgv?.igv_por_pagar)],
    ['Saldo a favor', money(detalleIgv?.saldo_a_favor)],
    [],
    ['PAGO A CUENTA DEL IR', ''],
    [regimenLabel, ''],
    ['Ingresos netos (base imponible)', money(detalleIr?.ingresos_netos)],
    [`Tasa ${Number(detalleIr?.tasa || 0) * 100}%`, ''],
    ['Pago a cuenta calculado', money(detalleIr?.pago_cuenta_calculado)],
    ['Pago a cuenta pagado (registrado)', money(detalleIr?.pago_cuenta_pagado)],
    ['Pago a cuenta del IR', money(detalleIr?.pago_cuenta)],
    [],
    ['TOTAL REFERENCIAL (IGV + IR)', money(resumen?.total_referencial)],
  ];

  if (gastosDetalle?.length) {
    filas.push([]);
    filas.push(['GASTOS DEDUCIBLES POR NATURALEZA', '']);
    gastosDetalle.forEach((g) => {
      filas.push([`${CATEGORIA_LABEL[g.categoria] || g.categoria} (${g.count} doc.)`, money(g.total)]);
    });
    filas.push(['Total gastos deducibles', money(resumen?.gastos_deducibles)]);
  }

  if (irAnual && Number(irAnual.ingresos_netos || 0) > 0) {
    filas.push([]);
    filas.push([
      irAnual.tramos_referencia
        ? 'DECLARACIÓN ANUAL DEL IR (REFERENCIAL - NO OFICIAL)'
        : 'DECLARACIÓN ANUAL DEL IR',
      '',
    ]);
    filas.push(['Ingresos netos del año', money(irAnual.ingresos_netos)]);
    filas.push(['(-) Gastos deducibles', -money(irAnual.gastos_deducibles)]);
    filas.push(['Renta neta', money(irAnual.renta_neta)]);
    filas.push([`UIT ${irAnual.anio}`, money(irAnual.valor_uit)]);
    (irAnual.tramos || []).forEach((t) => {
      const rango = t.hasta_uit != null
        ? `De ${t.desde_uit} a ${t.hasta_uit} UIT`
        : `Desde ${t.desde_uit} UIT`;
      filas.push([`  ${rango} · base ${money(t.base_soles)} · ${Number(t.tasa) * 100}%`, money(t.impuesto)]);
    });
    filas.push(['Impuesto anual', money(irAnual.impuesto_anual)]);
    filas.push(['(-) Pagos a cuenta del año', -money(irAnual.pagos_a_cuenta)]);
    filas.push([
      irAnual.resultado === 'A_FAVOR' ? 'Saldo a favor' : 'Saldo a pagar',
      money(irAnual.saldo),
    ]);
    if (irAnual.tramos_referencia && irAnual.advertencia) {
      filas.push([]);
      filas.push(['ADVERTENCIA', irAnual.advertencia]);
    }
  }

  return filas;
}

export function exportTributarioToExcel(data, { anio, mes }) {
  const { config, resumen, gastos_deducibles_detalle: gastosDetalle, ir_anual: irAnual } = data || {};
  if (!resumen) return;

  const regimenLabel = REGIMEN_LABEL[config?.ir_regime] || `Régimen ${config?.ir_regime || 'RMT'}`;
  const periodo = mes ? `${MESES[mes - 1]} ${anio}` : `${anio} (todos los meses)`;

  const wsResumen = makeSheet(
    RESUMEN_HEADERS,
    RESUMEN_WIDTHS,
    [
      [`RESUMEN TRIBUTARIO — Período: ${periodo}`, ''],
      ...detalleRows({
        detalleIgv: data.detalle_igv,
        detalleIr: data.detalle_ir,
        irAnual,
        resumen,
        config,
        regimenLabel,
        gastosDetalle,
      }),
    ]
  );
  applyNumberFormats(wsResumen, RESUMEN_MONEY_COLS, '#,##0.00');

  const DETALLE_HEADERS = [
    'Mes', 'Ventas (S/)', 'IGV ventas', 'Compras (S/)', 'IGV compras',
    'Gastos deducibles', 'IGV por pagar', 'Pago a cuenta IR', 'Total referencial',
  ];
  const DETALLE_WIDTHS = [20, 16, 14, 16, 14, 18, 14, 16, 18];
  const DETALLE_MONEY_COLS = [1, 2, 3, 4, 5, 6, 7, 8];

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
      money(x.gastos_deducibles),
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
