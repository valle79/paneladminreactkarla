import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Modal';
import { Toolbar, useListReload, Loader, EmptyState, ErrorState, fmtDate, Badge } from '../components/ui';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../auth';
import { PaymentModal, PurchasePicker, fmtAmount } from '../components/PaymentModal';

export default function Pagos() {
  const toast = useToast();
  const { can } = useAuth();
  const { ask, ConfirmDialog } = useConfirm();

  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [pagination, setPagination] = useState(null);
  const [q, setQ] = useState('');

  const [picker, setPicker] = useState(false);
  const [paying, setPaying] = useState(null);

  const load = () => {
    setFailed(false);
    const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
    if (q) params.set('q', q);
    api.get(`/supplier-payments?${params}`)
      .then((r) => { setRows(r.data.items); setPagination(r.data.pagination); })
      .catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [page, q]);

  const reloadList = useListReload(page, setPage, load);

  const anular = async (p) => {
    const ok = await ask({
      title: 'Anular pago',
      message: `¿Deseas anular el pago de ${fmtAmount(p.monto, p.moneda)} a ${p.supplier_name || 'proveedor'} del ${fmtDate(p.fecha_pago)}? El saldo de la compra se recalculará.`,
      confirmText: 'Anular pago',
    });
    if (!ok) return;
    try {
      await api.put(`/supplier-payments/${p.id}/cancel`, { motivo: 'Anulado desde el panel de pagos' });
      toast.success('Pago anulado');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar los pagos" /> : <Loader text="Cargando pagos..." />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pagos a proveedores</h1>
          <div className="sub">Registro de pagos, historial y anulaciones</div>
        </div>
        {can('SUPPLIER_PAYMENTS_CREATE') && (
          <button className="btn btn-primary btn-lg" onClick={() => setPicker(true)}><Icon name="plus" size={17} /> Registrar pago</button>
        )}
      </div>

      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar por proveedor, compra u operación...">
          <span className="pill-count">{pagination?.total || 0} pagos</span>
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Compra</th>
                <th>Proveedor</th>
                <th>Medio</th>
                <th>Moneda</th>
                <th style={{ textAlign: 'right' }}>Monto</th>
                <th>N° operación</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="text-muted">{fmtDate(p.fecha_pago)}</td>
                  <td>
                    <b style={{ color: 'var(--g-forest)' }}>{p.codigo_compra}</b>
                  </td>
                  <td style={{ maxWidth: 220 }}>{p.supplier_name || '—'}</td>
                  <td><Badge kind="gray">{p.medio_pago}</Badge></td>
                  <td style={{ fontSize: 12 }}>{p.moneda}</td>
                  <td className="money" style={{ fontWeight: 700 }}>{fmtAmount(p.monto, p.moneda)}</td>
                  <td className="text-muted" style={{ fontSize: 12 }}>{p.numero_operacion || '—'}</td>
                  <td>{p.anulado ? <Badge kind="red">Anulado</Badge> : <Badge kind="green">Vigente</Badge>}</td>
                  <td>
                    <div className="row-actions">
                      {!p.anulado && can('SUPPLIER_PAYMENTS_UPDATE') && (
                        <button className="btn-icon danger" onClick={() => anular(p)} title="Anular pago"><Icon name="cancel" size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <EmptyState title={q ? 'Sin coincidencias' : 'No hay pagos registrados'} hint="Registra pagos desde Cuentas por pagar o desde el detalle de una compra" />}
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

      <PurchasePicker
        open={picker}
        onClose={() => setPicker(false)}
        onSelect={(p) => setPaying(p)}
      />
      <PaymentModal
        open={!!paying}
        onClose={() => setPaying(null)}
        purchase={paying}
        onDone={() => { load(); setPaying(null); }}
      />
      {ConfirmDialog}
    </>
  );
}