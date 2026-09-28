import { forwardRef } from 'react';
import { COMPANY } from '../config';
import logoElIqueno from '../images/Logo-El-Iqueño.png';

/* ============================================================
   TributaryReport: reporte A4 (vertical) del Resumen Tributario.
   Se captura a PDF con canvas (DocPdf.buildElementPdfBlob).
   Reutiliza las clases .sr-* + .trib-report (portrait 794px).
   ============================================================ */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const money = (n) =>
  `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

function TributaryReport(
  { data = null, anio = '', mes = null, user = null },
  ref
) {
  if (!data) return null;
  const {
    resumen = {}, detalle_igv = {}, detalle_ir = {}, config = {},
    annual = [], ir_anual: irAnual = {}, gastos_deducibles_detalle: gastosDetalle = [],
  } = data;

  const periodoLabel = mes
    ? `${MESES[mes - 1]} de ${anio}`
    : `${anio} — todos los meses`;

  const regimenLabel = REGIMEN_LABEL[config.ir_regime] || `Régimen ${config.ir_regime || 'RMT'}`;
  const tasaPct = Number(detalle_ir.tasa || 0) * 100;
  const tiposVentas = (config.ventas_igv_tipos || ['FACTURA', 'BOLETA']).join(' y ');
  const tiposCompras = (config.compras_igv_tipos || ['FACTURA']).join(', ');
  const hayAnual = Number(irAnual.ingresos_netos || 0) > 0;
  const saldoLabel = irAnual.resultado === 'A_FAVOR' ? 'Saldo a favor' : 'Saldo a pagar';

  const generado = new Date();
  const generadoStr =
    `${generado.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })} ` +
    `${generado.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`;

  const filas = (annual || [])
    .filter((x) => (mes ? x.mes === `${anio}-${String(mes).padStart(2, '0')}` : true))
    .map((x) => {
      const m = Number(x.mes.split('-')[1]);
      return [
        MESES[m - 1],
        x.ventas_total,
        x.ventas_igv,
        x.compras_total,
        x.compras_igv,
        x.igv_por_pagar,
        x.ir_pago_cuenta,
        x.total_referencial,
      ];
    });

  return (
    <div className="sales-report trib-report" ref={ref}>
      <div className="sr-head">
        <div className="sr-brand">
          <img src={logoElIqueno} alt={COMPANY.name} className="sr-logo" />
          <div>
            <div className="sr-name">{COMPANY.name}</div>
            <div className="sr-meta-line">RUC {COMPANY.ruc} · {COMPANY.address}</div>
            <div className="sr-meta-line">Tel: {COMPANY.phones.join(' / ')}</div>
          </div>
        </div>
        <div className="sr-title-box">
          <div className="sr-title">Resumen Tributario</div>
          <div className="sr-subtitle">{periodoLabel}</div>
        </div>
      </div>
      <div className="sr-rule" />

      <div className="sr-meta" style={{ flexWrap: 'wrap' }}>
        <div className="sr-meta-item"><span>Ventas (Facturas + Boletas)</span><b>{money(resumen.ventas_total)}</b></div>
        <div className="sr-meta-item"><span>Compras (crédito fiscal)</span><b>{money(resumen.compras_total)}</b></div>
        <div className="sr-meta-item"><span>IGV por pagar</span><b>{money(resumen.igv_por_pagar)}</b></div>
        <div className="sr-meta-item"><span>Pago a cuenta IR</span><b>{money(resumen.ir_pago_cuenta)}</b></div>
        <div className="sr-meta-item"><span>Total referencial</span><b>{money(resumen.total_referencial)}</b></div>
      </div>

      <div className="sr-table-wrap" style={{ marginTop: 14 }}>
        <table className="sr-table">
          <thead>
            <tr>
              <th>Mes</th>
              <th className="num">Ventas</th>
              <th className="num">IGV ventas</th>
              <th className="num">Compras</th>
              <th className="num">IGV compras</th>
              <th className="num">IGV a pagar</th>
              <th className="num">IR</th>
              <th className="num">Total ref.</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                <td>{f[0]}</td>
                <td className="num">{money(f[1])}</td>
                <td className="num">{money(f[2])}</td>
                <td className="num">{money(f[3])}</td>
                <td className="num">{money(f[4])}</td>
                <td className="num">{money(f[5])}</td>
                <td className="num">{money(f[6])}</td>
                <td className="num">{money(f[7])}</td>
              </tr>
            ))}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr>
                <td>Total general</td>
                <td className="num">{money(resumen.ventas_total)}</td>
                <td className="num">{money(resumen.ventas_igv)}</td>
                <td className="num">{money(resumen.compras_total)}</td>
                <td className="num">{money(resumen.compras_igv)}</td>
                <td className="num">{money(resumen.igv_por_pagar)}</td>
                <td className="num">{money(resumen.ir_pago_cuenta)}</td>
                <td className="num">{money(resumen.total_referencial)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="sr-table-wrap" style={{ marginTop: 14 }}>
        <table className="sr-table">
          <tbody>
            <tr>
              <td colSpan={2} style={{ fontSize: 12, fontWeight: 800, background: '#f0f5f1' }}>Detalle del IGV</td>
            </tr>
            <tr><td>IGV de ventas ({tiposVentas}, estado fiscal válido)</td><td className="num">{money(detalle_igv.igv_ventas)}</td></tr>
            <tr><td>IGV de compras (crédito fiscal: {tiposCompras})</td><td className="num">{money(detalle_igv.igv_compras)}</td></tr>
            <tr><td><b>IGV por pagar</b></td><td className="num"><b>{money(detalle_igv.igv_por_pagar)}</b></td></tr>
            {Number(detalle_igv.saldo_a_favor) > 0 && (
              <tr><td>Saldo a favor</td><td className="num">{money(detalle_igv.saldo_a_favor)}</td></tr>
            )}
            <tr>
              <td colSpan={2} style={{ fontSize: 12, fontWeight: 800, background: '#f0f5f1' }}>Pago a cuenta del IR</td>
            </tr>
            <tr><td>Régimen: {regimenLabel}</td><td className="num">Tasa {tasaPct.toLocaleString('es-PE')}%</td></tr>
            <tr><td>Ingresos netos (base imponible)</td><td className="num">{money(detalle_ir.ingresos_netos)}</td></tr>
            <tr><td>Pago a cuenta calculado</td><td className="num">{money(detalle_ir.pago_cuenta_calculado)}</td></tr>
            <tr><td>Pago a cuenta pagado (registrado)</td><td className="num">{money(detalle_ir.pago_cuenta_pagado)}</td></tr>
            <tr><td><b>Pago a cuenta del IR</b></td><td className="num"><b>{money(detalle_ir.pago_cuenta)}</b></td></tr>

            {gastosDetalle.length > 0 && (
              <>
                <tr>
                  <td colSpan={2} style={{ fontSize: 12, fontWeight: 800, background: '#f0f5f1' }}>
                    Gastos deducibles por naturaleza
                  </td>
                </tr>
                {gastosDetalle.map((g) => (
                  <tr key={g.categoria}>
                    <td>{CATEGORIA_LABEL[g.categoria] || g.categoria} ({g.count} doc.)</td>
                    <td className="num">{money(g.total)}</td>
                  </tr>
                ))}
                <tr><td><b>Total deducible</b></td><td className="num"><b>{money(resumen.gastos_deducibles)}</b></td></tr>
              </>
            )}

            {hayAnual && (
              <>
                <tr>
                  <td colSpan={2} style={{ fontSize: 12, fontWeight: 800, background: '#f0f5f1' }}>
                    Declaración anual del IR{irAnual.tramos_referencia ? ' (referencial, no oficial)' : ''}
                  </td>
                </tr>
                <tr><td>Ingresos netos del año</td><td className="num">{money(irAnual.ingresos_netos)}</td></tr>
                <tr><td>(−) Gastos deducibles</td><td className="num">−{money(irAnual.gastos_deducibles)}</td></tr>
                <tr><td><b>Renta neta</b></td><td className="num"><b>{money(irAnual.renta_neta)}</b></td></tr>
                <tr><td>UIT {irAnual.anio}</td><td className="num">{money(irAnual.valor_uit)}</td></tr>
                {(irAnual.tramos || []).map((t, i) => (
                  <tr key={i}>
                    <td>
                      {t.hasta_uit != null
                        ? `Tramo ${t.desde_uit}–${t.hasta_uit} UIT`
                        : `Tramo desde ${t.desde_uit} UIT`}
                      {' · base '}{money(t.base_soles)}{' · '}{(Number(t.tasa) * 100).toLocaleString('es-PE')}%
                    </td>
                    <td className="num">{money(t.impuesto)}</td>
                  </tr>
                ))}
                <tr><td>Impuesto anual</td><td className="num">{money(irAnual.impuesto_anual)}</td></tr>
                <tr><td>(−) Pagos a cuenta del año</td><td className="num">−{money(irAnual.pagos_a_cuenta)}</td></tr>
                <tr><td><b>{saldoLabel}</b></td><td className="num"><b>{money(irAnual.saldo)}</b></td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {hayAnual && irAnual.tramos_referencia && (
        <div className="sr-foot-note" style={{ marginTop: 10, color: '#8a6400' }}>
          <b>Advertencia:</b> {irAnual.advertencia}
        </div>
      )}

      <div className="sr-foot">
        <div className="sr-foot-note">
          Reporte generado el {generadoStr}. Resumen informativo basado en los comprobantes registrados: IGV de ventas por
          {` ${tiposVentas}`} en estado fiscal válido; crédito fiscal por compras con comprobante{` ${tiposCompras}`}
          {' '}recibidas. El pago a cuenta del IR se calcula sobre los ingresos netos ({regimenLabel}). Los gastos
          deducibles son los registrados explícitamente con su naturaleza y sustento. Este documento no sustituye las
          declaraciones ni los pagos ante SUNAT.
        </div>
        <div className="sr-sign">
          <div className="sr-sign-name">{user?.name || COMPANY.seller.name}</div>
          <div className="sr-sign-role">{user?.roles?.[0]?.name || COMPANY.seller.role}</div>
          <div className="sr-sign-company">{COMPANY.name}</div>
          <div className="sr-sign-email">{user?.email || COMPANY.seller.email || COMPANY.emails[0]}</div>
        </div>
      </div>
    </div>
  );
}

export default forwardRef(TributaryReport);