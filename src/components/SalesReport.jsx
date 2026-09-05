import { forwardRef, useMemo } from 'react';
import { COMPANY, formatDocNumber } from '../config';
import logoElIqueno from '../images/Logo-El-Iqueño.png';

/* ============================================================
   SalesReport: reporte de ventas (A4 horizontal) generado a
   partir de los filtros activos. Se captura a PDF con canvas.
   ============================================================ */

const ESTADO = {
  pagado: { label: 'CANCELADO', cls: 'sr-badge-paid' },
  a_cuenta: { label: 'PAGO PARCIAL', cls: 'sr-badge-partial' },
  por_pagar: { label: 'PENDIENTE', cls: 'sr-badge-pending' },
};

const ITEM_LABEL = { machine: 'Producto', repuesto: 'Repuesto', service: 'Servicio', manual: 'Item manual' };

const money = (n) =>
  `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dateFmt = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

const clientName = (s) => {
  const c = s.client || {};
  return c.names ? `${c.names} ${c.last_names || ''}`.trim() : c.razonsocial || '—';
};

const paymentSaldo = (s) => {
  const status = s.payment_status || 'por_pagar';
  if (status === 'pagado') return 0;
  if (status === 'a_cuenta') {
    return Number(s.amount_pending != null ? s.amount_pending : Number(s.total || 0) - Number(s.amount_paid || 0));
  }
  return Number(s.total || 0);
};

function SalesReport({ sales = [], dateFrom = '', dateTo = '', q = '', user = null }, ref) {
  const stats = useMemo(() => {
    const total = (f) => sales.reduce((acc, s) => acc + Number(f(s) || 0), 0);
    return {
      count: sales.length,
      valor: total((s) => s.subtotal),
      igv: total((s) => s.igv),
      descuento: total((s) => s.discount_amount),
      total: total((s) => s.total),
      saldo: total(paymentSaldo),
    };
  }, [sales]);

  const periodo = dateFrom || dateTo
    ? `${dateFrom ? dateFmt(dateFrom) : 'Inicio'} — ${dateTo ? dateFmt(dateTo) : 'Hoy'}`
    : 'Todo el historial';

  const generado = new Date();
  const generadoStr =
    `${generado.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })} ` +
    `${generado.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className="sales-report" ref={ref}>
      <div className="sr-head">
        <div className="sr-brand">
          <img src={logoElIqueno} alt={COMPANY.name} className="sr-logo" />
          <div>
            <div className="sr-name">{COMPANY.name}</div>
            <div className="sr-meta-line">RUC {COMPANY.ruc} · {COMPANY.address}</div>
            <div className="sr-meta-line">Tel: {COMPANY.phones.join(' / ')} · {COMPANY.emails[0]}</div>
          </div>
        </div>
        <div className="sr-title-box">
          <div className="sr-title">Reporte de ventas</div>
          <div className="sr-subtitle">{periodo}</div>
        </div>
      </div>
      <div className="sr-rule" />

      <div className="sr-meta">
        <div className="sr-meta-item"><span>Período</span><b>{periodo}</b></div>
        <div className="sr-meta-item"><span>Búsqueda</span><b>{q ? `“${q}”` : '—'}</b></div>
        <div className="sr-meta-item"><span>N° de ventas</span><b>{stats.count}</b></div>
        <div className="sr-meta-item"><span>Total facturado</span><b>{money(stats.total)}</b></div>
      </div>

      <div className="sr-table-wrap">
        <table className="sr-table">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Cliente</th>
              <th>Tipo</th>
              <th>Ítem vendido</th>
              <th>Fecha</th>
              <th className="num">Valor</th>
              <th className="num">IGV</th>
              <th className="num">Desc.</th>
              <th className="num">Total</th>
              <th>Estado</th>
              <th className="num">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => {
              const st = ESTADO[s.payment_status] || ESTADO.por_pagar;
              const saldo = paymentSaldo(s);
              const items = s.items || [];
              return (
                <tr key={s.id}>
                  <td className="sr-doc">{formatDocNumber(s.invoice_type, s.invoice_number)}</td>
                  <td className="sr-client">
                    {clientName(s)}
                    <div className="sr-sub">{s.client?.dni || s.client?.ruc || ''}</div>
                  </td>
                  <td className="sr-types">
                    {items.map((it, ix) => {
                      const type = ITEM_LABEL[it.item_type] || it.item_type || 'Item';
                      return <div className="sr-item-type" key={ix}>{type}</div>;
                    })}
                  </td>
                  <td className="sr-items">
                    {items.map((it, ix) => {
                      const q = Number(it.quantity || 0);
                      const name = it.name || it.manual_name || 'Item';
                      return (
                        <div className="sr-item" key={ix}>
                          {name}{q && q !== 1 ? ` × ${q}` : ''}
                        </div>
                      );
                    })}
                  </td>
                  <td className="num">{dateFmt(s.created_at)}</td>
                  <td className="num">{money(s.subtotal)}</td>
                  <td className="num">{money(s.igv)}</td>
                  <td className="num">{s.discount_amount ? `−${money(s.discount_amount)}` : '—'}</td>
                  <td className="num sr-total">{money(s.total)}</td>
                  <td><span className={`sr-badge ${st.cls}`}>{st.label}</span></td>
                  <td className="num">{saldo ? money(saldo) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          {sales.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={5}>Total general</td>
                <td className="num">{money(stats.valor)}</td>
                <td className="num">{money(stats.igv)}</td>
                <td className="num">−{money(stats.descuento)}</td>
                <td className="num">{money(stats.total)}</td>
                <td />
                <td className="num">{money(stats.saldo)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="sr-foot">
        <div className="sr-foot-note">
          Reporte generado el {generadoStr} · Los importes incluyen el IGV desglosado por documento.
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

export default forwardRef(SalesReport);