import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import { Toolbar, useSearch, useListReload, Loader, EmptyState, ErrorState, fmtMoney } from '../components/ui';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../auth';

const empty = { name: '', price: '' };

export default function Services() {
  const toast = useToast();
  const { can } = useAuth();
  const { ask, ConfirmDialog } = useConfirm();
  const [rows, setRows] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [pagination, setPagination] = useState(null);

  const load = () => {
    setFailed(false);
    const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
    api.get(`/services?${params}`).then((r) => { setRows(r.data.items); setPagination(r.data.pagination); }).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [page]);

  const { q, setQ, filtered } = useSearch(rows || [], [(r) => r.name]);
  const reloadList = useListReload(page, setPage, load, editingId);

  const openAdd = () => { setEditingId(null); setForm(empty); setModal(true); };
  const openEdit = (r) => { setEditingId(r.id); setForm({ name: r.name, price: r.price }); setModal(true); };

  const save = async () => {
    if (!form.name.trim()) return toast.warning('El nombre es obligatorio');
    if (form.price === '' || Number(form.price) <= 0) return toast.warning('El precio debe ser mayor a 0');
    setBusy(true);
    try {
      const payload = { name: form.name.trim(), price: parseFloat(String(form.price).replace(',', '.')) };
      if (editingId) {
        await api.put(`/services/${editingId}`, payload);
        toast.success('Servicio actualizado');
      } else {
        await api.post('/services', payload);
        toast.success('Servicio creado');
      }
      setModal(false);
      reloadList();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const remove = async (r) => {
    const ok = await ask({ title: 'Eliminar servicio', message: `¿Deseas eliminar "${r.name}"?`, confirmText: 'Eliminar' });
    if (!ok) return;
    try {
      await api.delete(`/services/${r.id}`);
      toast.success('Servicio eliminado');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar los servicios" /> : <Loader text="Cargando servicios..." />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Servicios</h1>
          <div className="sub">Servicios técnicos ofrecidos por la empresa</div>
        </div>
        {can('SERVICES_CREATE') && <button className="btn btn-primary btn-lg" onClick={openAdd}><Icon name="plus" size={17} /> Agregar Servicio</button>}
      </div>

      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar servicio...">
          <span className="pill-count">{filtered.length} servicios</span>
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Servicio</th>
                <th>Precio</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td data-label="Servicio">
                    <div className="flex">
                      <span className="thumb-wrap" style={{ width: 38, height: 38 }}><Icon name="money-bag" size={17} /></span>
                      <span className="cell-title">{r.name}</span>
                    </div>
                  </td>
                  <td data-label="Precio" className="money"><b>{fmtMoney(r.price)}</b></td>
                  <td>
                    <div className="row-actions">
                      {can('SERVICES_UPDATE') && <button className="btn-icon" onClick={() => openEdit(r)} title="Editar"><Icon name="edit" size={14} /></button>}
                      {can('SERVICES_DELETE') && <button className="btn-icon danger" onClick={() => remove(r)} title="Eliminar"><Icon name="trash" size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title={q ? 'Sin coincidencias' : 'No hay servicios'} hint={q ? 'Prueba con otro término' : 'Agrega tu primer servicio'} />}
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

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editingId ? 'Editar servicio' : 'Nuevo servicio'}
        icon={<Icon name="money-bag" size={18} />}
        size="sm"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="save" size={15} />} Guardar
            </button>
          </>
        }
      >
        <div className="field">
          <label>Nombre del servicio <span className="req">*</span></label>
          <input className="input" placeholder="Ej. Mantenimiento Preventivo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label>Precio (S/) <span className="req">*</span></label>
          <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </div>
      </Modal>

      {ConfirmDialog}
    </>
  );
}