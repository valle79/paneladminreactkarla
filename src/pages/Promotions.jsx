import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import { Toolbar, useSearch, useListReload, Loader, EmptyState, ErrorState, fmtDate, Badge } from '../components/ui';
import { FileUpload } from '../components/FileUpload';
import { Pagination } from '../components/Pagination';

const empty = {
  title: '', subtitle: '', features: '', valid_until: '',
  is_active: true, show_in_web: false, display_order: 0,
  image_url: null, media_type: 'image',
};

export default function Promotions() {
  const toast = useToast();
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
    api.get(`/promotions?${params}`).then((r) => { setRows(r.data.items); setPagination(r.data.pagination); }).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [page]);

  const { q, setQ, filtered } = useSearch(rows || [], [(r) => r.title, (r) => r.subtitle, (r) => r.valid_until]);
  const reloadList = useListReload(page, setPage, load, editingId);

  const openAdd = () => { setEditingId(null); setForm(empty); setModal(true); };
  const openEdit = (r) => {
    setEditingId(r.id);
    setForm({
      title: r.title, subtitle: r.subtitle || '', features: r.features || '',
      valid_until: r.valid_until, is_active: r.is_active, show_in_web: r.show_in_web,
      display_order: r.display_order || 0, image_url: r.image_url, media_type: r.media_type || 'image',
    });
    setModal(true);
  };

  const toggle = async (r, field) => {
    try {
      await api.put(`/promotions/${r.id}`, { [field]: !r[field] });
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const save = async () => {
    if (!form.title.trim()) return toast.warning('El título es obligatorio');
    if (!form.valid_until.trim()) return toast.warning('La vigencia es obligatoria');
    setBusy(true);
    try {
      const payload = { ...form, title: form.title.trim(), valid_until: form.valid_until.trim(), display_order: Number(form.display_order) || 0 };
      if (editingId) {
        await api.put(`/promotions/${editingId}`, payload);
        toast.success('Promoción actualizada');
      } else {
        await api.post('/promotions', payload);
        toast.success('Promoción creada');
      }
      setModal(false);
      reloadList();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const remove = async (r) => {
    const ok = await ask({ title: 'Eliminar promoción', message: `¿Deseas eliminar "${r.title}"? Esta acción no se puede deshacer.`, confirmText: 'Eliminar definitivamente' });
    if (!ok) return;
    try {
      await api.delete(`/promotions/${r.id}`);
      toast.success('Promoción eliminada');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar las promociones" /> : <Loader text="Cargando promociones..." />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Promociones</h1>
          <div className="sub">Ofertas visibles en la web y en el sistema</div>
        </div>
        <button className="btn btn-yellow btn-lg" onClick={openAdd}><Icon name="plus" size={17} /> Agregar Promoción</button>
      </div>

      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar promoción...">
          <span className="pill-count">{filtered.length} promociones</span>
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Imagen</th>
                <th>Promoción</th>
                <th>Vigencia</th>
                <th>Estado</th>
                <th>Visibilidad web</th>
                <th>Orden</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td data-label="Imagen">
                    {r.image_url ? (
                      r.media_type === 'video' ? (
                        <div className="thumb-wrap" style={{ position: 'relative' }}><Icon name="price-tag" size={20} /></div>
                      ) : (
                        <a href={r.image_url} target="_blank" rel="noreferrer"><span className="thumb-wrap" style={{ width: 58, height: 58 }}><img className="thumb" src={r.image_url} alt={r.title} /></span></a>
                      )
                    ) : <span className="thumb-wrap"><Icon name="price-tag" size={18} /></span>}
                  </td>
                  <td data-label="Promoción" style={{ maxWidth: 320 }}>
                    <div className="cell-title">{r.title}</div>
                    <div className="desc-cell">{r.subtitle || ''}</div>
                  </td>
                  <td data-label="Vigencia" className="text-muted">{r.valid_until}</td>
                  <td data-label="Estado">
                    <button className="btn btn-sm btn-ghost" style={{ padding: 0 }} onClick={() => toggle(r, 'is_active')} title="Cambiar estado">
                      {r.is_active ? <Badge kind="green">Activa</Badge> : <Badge kind="gray">Inactiva</Badge>}
                    </button>
                  </td>
                  <td data-label="Visibilidad web">
                    <button className="btn btn-sm btn-ghost" style={{ padding: 0 }} onClick={() => toggle(r, 'show_in_web')} title="Cambiar visibilidad">
                      {r.show_in_web ? <Badge kind="yellow"><Icon name="globe" size={11} /> Visible</Badge> : <Badge kind="gray"><Icon name="hide" size={11} /> Oculta</Badge>}
                    </button>
                  </td>
                  <td data-label="Orden"><span className="chip"><Icon name="sort" size={12} /> {r.display_order}</span></td>
                  <td>
                    <div className="row-actions">
<button className="btn-icon" onClick={() => openEdit(r)} title="Editar"><Icon name="edit" size={14} /></button>
            <button className="btn-icon danger" onClick={() => remove(r)} title="Eliminar"><Icon name="trash" size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title={q ? 'Sin coincidencias' : 'No hay promociones'} hint="Agrega tu primera promoción" />}
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
        title={editingId ? 'Editar promoción' : 'Nueva promoción'}
        icon={<Icon name="price-tag" size={18} />}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-yellow" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="save" size={15} />} Guardar promoción</button>
          </>
        }
      >
        <div className="field">
          <label>Título <span className="req">*</span></label>
          <input className="input" maxLength={200} placeholder="Ej. Cadena Transportadora" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="field">
          <label>Subtítulo</label>
          <input className="input" maxLength={200} placeholder="Ej. Nueva Presentación 2026" value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Vigencia <span className="req">*</span></label>
            <input className="input" placeholder="Ej. 30 de Abril del 2026" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
          </div>
          <div className="field">
            <label>Orden de visualización</label>
            <input className="input" type="number" min="0" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Detalle de la oferta</label>
          <textarea className="textarea" rows={5} placeholder="Describe los beneficios de la promoción" value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} />
        </div>
        <div className="field">
          <label>Imagen o video</label>
          <FileUpload
            value={form.image_url}
            onChange={(u) => setForm({ ...form, image_url: u, media_type: u ? (u.includes('.mp4') || u.includes('.webm') || u.includes('.mov') ? 'video' : 'image') : form.media_type })}
            accept="image/*,video/*"
            isImage={form.media_type !== 'video'}
            label="Arrastra una imagen o video (máx. 60MB)"
          />
        </div>
        <div className="grid-2">
          <label className="check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            <span><b>Promoción activa</b><br /><span className="hint">Disponible para mostrarse</span></span>
          </label>
          <label className="check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={form.show_in_web} onChange={(e) => setForm({ ...form, show_in_web: e.target.checked })} />
            <span><b>Visible en la web</b> <Icon name="visible" size={12} /><br /><span className="hint">Se muestra en el sitio público del Iqueño</span></span>
          </label>
        </div>
      </Modal>

      {ConfirmDialog}
    </>
  );
}