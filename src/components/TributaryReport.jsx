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

function TributaryReport(
  { data = null, anio = '', mes = null, user = null },
  ref
) {
  if (!data) return null;
  const { resumen = {}, detalle_igv = {}, detalle_ir = {}, config = {}, annual = [] } = data;

  const periodoLabel = mes
    ? `${MESES[mes - 1]} de ${anio}`
    : `${anio} — todos los meses`;

  const regimenLabel = REGIMEN_LABEL[config.ir_regime] || `Régimen ${config.ir_regime || 'RMT'}`;
  const tasaPct = Number(detalle_ir.tasa || 0) * 100;

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
            <tr><td>IGV de ventas (Facturas + Boletas)</td><td className="num">{money(detalle_igv.igv_ventas)}</td></tr>
            <tr><td>IGV de compras (crédito fiscal, solo FACTURAS)</td><td className="num">{money(detalle_igv.igv_compras)}</td></tr>
            <tr><td><b>IGV por pagar</b></td><td className="num"><b>{money(detalle_igv.igv_por_pagar)}</b></td></tr>
            {Number(detalle_igv.saldo_a_favor) > 0 && (
              <tr><td>Saldo a favor</td><td className="num">{money(detalle_igv.saldo_a_favor)}</td></tr>
            )}
            <tr>
              <td colSpan={2} style={{ fontSize: 12, fontWeight: 800, background: '#f0f5f1' }}>Pago a cuenta del IR</td>
            </tr>
            <tr><td>Régimen: {regimenLabel}</td><td className="num">Tasa {tasaPct.toLocaleString('es-PE')}%</td></tr>
            <tr><td>Ingresos netos (base imponible)</td><td className="num">{money(detalle_ir.ingresos_netos)}</td></tr>
            <tr><td><b>Pago a cuenta del IR</b></td><td className="num"><b>{money(detalle_ir.pago_cuenta)}</b></td></tr>
          </tbody>
        </table>
      </div>

      <div className="sr-foot">
        <div className="sr-foot-note">
          Reporte generado el {generadoStr}. Resumen informativo basado en los comprobantes registrados: IGV de ventas por
          FACTURAS y BOLETAS; crédito fiscal por compras con comprobante FACTURA. El pago a cuenta del IR se estima sobre
          los ingresos netos ({regimenLabel}). Este documento no sustituye las declaraciones ni los pagos ante SUNAT.
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