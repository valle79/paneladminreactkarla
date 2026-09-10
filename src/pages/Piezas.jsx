import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import { Toolbar, useSearch, useListReload, Loader, EmptyState, ErrorState, fmtMoney, fmtDate } from '../components/ui';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../auth';

const UNITS = ['UND', 'PZA', 'JGO', 'KG', 'GR', 'MT', 'LT', 'CJ', 'PAR', 'SERV', 'GAL'];

const empty = { codigo: '', name: '', descripcion: '', precio: '', unidad: 'UND', stock: 0 };

export default function Piezas() {
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
    api.get(`/piezas?${params}`).then((r) => { setRows(r.data.items); setPagination(r.data.pagination); }).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [page]);

  const { q, setQ, filtered } = useSearch(rows || [], [(r) => r.name, (r) => r.codigo, (r) => r.descripcion]);
  const reloadList = useListReload(page, setPage, load, editingId);

  const openAdd = () => { setEditingId(null); setForm(empty); setModal(true); };
  const openEdit = (r) => {
    setEditingId(r.id);
    setForm({ codigo: r.codigo || '', name: r.name || '', descripcion: r.descripcion || '', precio: r.precio ?? '', unidad: r.unidad || 'UND', stock: r.stock ?? 0 });
    setModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast.warning('El nombre es obligatorio');
    if (form.precio === '' || Number(form.precio) <= 0) return toast.warning('El precio debe ser mayor a 0');
    setBusy(true);
    try {
      const payload = {
        codigo: form.codigo.trim() || null,
        name: form.name.trim(),
        descripcion: form.descripcion,
        precio: parseFloat(String(form.precio).replace(',', '.')),
        unidad: form.unidad || 'UND',
        stock: Number(form.stock) || 0,
      };
      if (editingId) {
        await api.put(`/piezas/${editingId}`, payload);
        toast.success('Pieza actualizada');
      } else {
        await api.post('/piezas', payload);
        toast.success('Pieza creada');
      }
      setModal(false);
      reloadList();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const remove = async (r) => {
    const ok = await ask({ title: 'Eliminar pieza', message: `¿Deseas eliminar "${r.name}"?`, confirmText: 'Eliminar' });
    if (!ok) return;
    try {
      await api.delete(`/piezas/${r.id}`);
      toast.success('Pieza eliminada');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar las piezas" /> : <Loader text="Cargando piezas..." />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Piezas</h1>
          <div className="sub">Listado de piezas a utilizar en la elaboración de productos</div>
        </div>
        {can('PIEZAS_CREATE') && (
          <button className="btn btn-yellow btn-lg" onClick={openAdd}><Icon name="plus" size={17} /> Agregar Pieza</button>
        )}
      </div>

      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar pieza...">
          <span className="pill-count">{filtered.length} piezas</span>
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Pieza</th>
                <th>Código</th>
                <th>Descripción</th>
                <th>Unidad</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Registro</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td data-label="Pieza"><div className="cell-title">{r.name}</div></td>
                  <td data-label="Código"><span className="chip">{r.codigo || '—'}</span></td>
                  <td data-label="Descripción" style={{ maxWidth: 320 }}><span className="desc-cell">{r.descripcion || ''}</span></td>
                  <td data-label="Unidad">{r.unidad}</td>
                  <td data-label="Precio" className="money"><b>{fmtMoney(r.precio)}</b></td>
                  <td data-label="Stock" className="money">{r.stock}</td>
                  <td data-label="Registro" className="text-muted">{fmtDate(r.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      {can('PIEZAS_UPDATE') && <button className="btn-icon" onClick={() => openEdit(r)} title="Editar"><Icon name="edit" size={14} /></button>}
                      {can('PIEZAS_DELETE') && <button className="btn-icon danger" onClick={() => remove(r)} title="Eliminar"><Icon name="trash" size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title={q ? 'Sin coincidencias' : 'No hay piezas'} hint={q ? 'Prueba con otro término' : 'Agrega tu primera pieza'} />}
        </div>
        {pagination && pagination.total_pages > 1 && (
          <Pagination currentPage={pagination.page} totalPages={pagination.total_pages} totalItems={pagination.total} limit={pagination.limit} onPageChange={setPage} />
        )}
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editingId ? 'Editar pieza' : 'Nueva pieza'}
        icon={<Icon name="ruler" size={18} />}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-yellow" onClick={save} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="save" size={15} />} Guardar pieza
            </button>
          </>
        }
      >
        <div className="grid-2">
          <div className="field">
            <label>Nombre <span className="req">*</span></label>
            <input className="input" placeholder="Ej. Eje de transmisión" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Código</label>
            <input className="input" placeholder="Ej. PZ-001" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label>Descripción</label>
          <textarea className="textarea" placeholder="Descripción breve de la pieza" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
        </div>

        <div className="grid-3">
          <div className="field">
            <label>Precio (S/) <span className="req">*</span></label>
            <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} />
          </div>
          <div className="field">
            <label>Unidad</label>
            <select className="input" value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value })}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Stock</label>
            <input className="input" type="number" min="0" step="1" placeholder="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
          </div>
        </div>
      </Modal>

      {ConfirmDialog}
    </>
  );
}