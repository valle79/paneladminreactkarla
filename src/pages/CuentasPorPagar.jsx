import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Toolbar, useListReload, Loader, EmptyState, ErrorState, fmtDate, Badge } from '../components/ui';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../auth';
import { PaymentModal, PaymentsList, fmtAmount, CURRENCIES } from '../components/PaymentModal';

const ESTADO_CXP_MAP = {
  PENDIENTE: ['red', 'Pendiente'],
  PAGADA_PARCIAL: ['yellow', 'Pagada parcial'],
  PAGADA: ['green', 'Pagada'],
  VENCIDA: ['red', 'Vencida'],
  POR_VENCER: ['blue', 'Por vencer'],
};

const ESTADO_FILTERS = [
  ['', 'Todos'],
  ['VENCIDA', 'Vencidas'],
  ['POR_VENCER', 'Por vencer'],
  ['PENDIENTE', 'Pendientes'],
  ['PAGADA', 'Pagadas'],
];

export default function CuentasPorPagar() {
  const toast = useToast();
  const { can } = useAuth();

  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(12);
  const [pagination, setPagination] = useState(null);
  const [summaries, setSummaries] = useState(null);
  const [estado, setEstado] = useState('');
  const [moneda, setMoneda] = useState('');
  const [q, setQ] = useState('');

  const [paying, setPaying] = useState(null);
  const [listModal, setListModal] = useState(null);

  const load = () => {
    setFailed(false);
    const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
    if (q) params.set('q', q);
    if (estado) params.set('estado', estado);
    if (moneda) params.set('moneda', moneda);
    api.get(`/accounts-payable?${params}`)
      .then((r) => {
        setRows(r.data.items);
        setPagination(r.data.pagination);
        setSummaries(r.data.summaries);
      })
      .catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [page, estado, moneda, q]);

  const reloadList = useListReload(page, setPage, load);

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar las cuentas por pagar" /> : <Loader text="Cargando cuentas por pagar..." />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cuentas por pagar</h1>
          <p className="text-muted">Saldo pendiente total: <b className="money" style={{ color: 'var(--g-forest)' }}>{fmtAmount(summaries?.saldo_equivalente)}</b> · Deuda total: <b className="money">{fmtAmount(summaries?.total_equivalente)}</b></p>
        </div>
      </div>

      <Toolbar search={q} onSearch={setQ} placeholder="Buscar por proveedor, RUC o código...">
        <select className="select" style={{ width: 'auto' }} value={estado} onChange={(e) => { setPage(1); setEstado(e.target.value); }}>
          {ESTADO_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={moneda} onChange={(e) => { setPage(1); setMoneda(e.target.value); }}>
          <option value="">Todas las monedas</option>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="pill-count">{rows.length} registros</span>
      </Toolbar>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Código</th>
                <th>Proveedor</th>
                <th>Fecha</th>
                <th>Vencimiento</th>
                <th>Moneda</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Pagado</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                <th style={{ textAlign: 'right' }}>Saldo S/.</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [ek, el] = ESTADO_CXP_MAP[r.display_estado] || ['gray', r.display_estado];
                const vencida = r.display_estado === 'VENCIDA';
                return (
                  <tr key={r.purchase_id}>
                    <td>
                      <Link to={r.tipo_compra === 'INTERNACIONAL' ? '/compras-exteriores' : '/compras-interiores'} style={{ textDecoration: 'none' }}>
                        <b style={{ color: 'var(--g-forest)' }}>{r.codigo_compra}</b>
                      </Link>
                      <div className="text-muted" style={{ fontSize: 11.5 }}>{r.tipo_compra}</div>
                    </td>
                    <td style={{ maxWidth: 240 }}>
                      <div className="cell-title">{r.supplier?.razon_social || '—'}</div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {r.supplier?.tipo_documento ? `${r.supplier.tipo_documento} ` : ''}{r.supplier?.numero_documento || ''}
                      </div>
                    </td>
                    <td className="text-muted">{fmtDate(r.fecha_compra)}</td>
                    <td className="text-muted">
                      {r.fecha_vencimiento ? fmtDate(r.fecha_vencimiento) : '—'}
                      {vencida && <div style={{ fontSize: 11, color: 'var(--danger)' }}>Vencida</div>}
                    </td>
                    <td><Badge kind="gray">{r.moneda}</Badge></td>
                    <td className="money">{fmtAmount(r.total, r.moneda)}</td>
                    <td className="money text-muted">{fmtAmount(r.total_pagado, r.moneda)}</td>
                    <td className="money" style={{ fontWeight: 700, color: Number(r.saldo) > 0 ? 'var(--danger)' : 'var(--g-primary)' }}>
                      {fmtAmount(r.saldo, r.moneda)}
                    </td>
                    <td className="money text-muted">{fmtAmount(r.saldo_equivalente)}</td>
                    <td><Badge kind={ek}>{el}</Badge></td>
                    <td>
                      <div className="row-actions">
                        {can('SUPPLIER_PAYMENTS_CREATE') && Number(r.saldo) > 0 && (
                          <button className="btn-icon" style={{ background: 'var(--g-soft)', color: 'var(--g-dark)', border: '1px solid var(--g-primary)' }} onClick={() => setPaying({ ...r, id: r.purchase_id })} title="Registrar pago"><Icon name="money" size={14} /></button>
                        )}
                        {can('SUPPLIER_PAYMENTS_VIEW') && (
                          <button className="btn-icon" onClick={() => setListModal(r)} title="Ver pagos"><Icon name="credit-card" size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <EmptyState title={q || estado || moneda ? 'Sin coincidencias' : 'No hay cuentas por pagar'} hint="Todas las compras están pagadas" />}
        </div>
        {pagination && pagination.total_pages > 1 && (
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.total_pages}
            totalItems={pagination.total}
            limit={pagination.limit}
            onPageChange={setPage}
          />
        )}
      </div>

      <PaymentModal
        open={!!paying}
        onClose={() => setPaying(null)}
        purchase={paying}
        onDone={() => load()}
      />
      <PaymentsList
        open={!!listModal}
        onClose={() => setListModal(null)}
        purchaseId={listModal?.purchase_id}
      />
    </>
  );
}