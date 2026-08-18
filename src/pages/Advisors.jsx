import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import { Toolbar, useSearch, Loader, EmptyState, ErrorState, AvatarCell, fmtDate } from '../components/ui';
import { FileUpload } from '../components/FileUpload';
import { Pagination } from '../components/Pagination';

const SPECIALTIES = ['Maquinaria', 'Tractores', 'Agricultura', 'Proyectos Especiales', 'Servicio al Cliente', 'Administracion', 'Ventas', 'Otros'];

const empty = { name: '', position: '', whatsapp: '', specialties: [], image_url: null };

function parseSpecialties(v) {
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
}

export default function Advisors() {
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
    api.get(`/advisors?${params}`).then((r) => { setRows(r.data.items); setPagination(r.data.pagination); }).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [page]);

  const { q, setQ, filtered } = useSearch(rows || [], [(r) => r.name, (r) => r.position, (r) => r.whatsapp]);

  const openAdd = () => { setEditingId(null); setForm(empty); setModal(true); };
  const openEdit = (r) => {
    setEditingId(r.id);
    setForm({
      name: r.name || '',
      position: r.position || '',
      whatsapp: r.whatsapp || '',
      specialties: parseSpecialties(r.specialties),
      image_url: r.image_url,
    });
    setModal(true);
  };

  const toggleSpec = (s) =>
    setForm((f) => ({
      ...f,
      specialties: f.specialties.includes(s) ? f.specialties.filter((x) => x !== s) : [...f.specialties, s],
    }));

  const save = async () => {
    if (!form.name.trim()) return toast.warning('El nombre es obligatorio');
    if (!form.whatsapp.trim()) return toast.warning('El WhatsApp es obligatorio');
    setBusy(true);
    try {
      const payload = { ...form, name: form.name.trim(), whatsapp: form.whatsapp.trim(), specialties: JSON.stringify(form.specialties) };
      if (editingId) {
        await api.put(`/advisors/${editingId}`, payload);
        toast.success('Asesor actualizado');
      } else {
        await api.post('/advisors', payload);
        toast.success('Asesor creado');
      }
      setModal(false);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const remove = async (r) => {
    const ok = await ask({
      title: 'Eliminar asesor',
      message: `¿Deseas eliminar a ${r.name}? Se guardará como inactivo y podrás restaurarlo.`,
      confirmText: 'Eliminar',
    });
    if (!ok) return;
    try {
      await api.delete(`/advisors/${r.id}`);
      toast.success('Asesor eliminado');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar los asesores" /> : <Loader text="Cargando asesores..." />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Asesores</h1>
          <div className="sub">Personal de asesoría técnica y comercial</div>
        </div>
        <button className="btn btn-primary btn-lg" onClick={openAdd}><Icon name="plus" size={17} /> Agregar Asesor</button>
      </div>

      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar por nombre, cargo o WhatsApp...">
          <span className="pill-count">{filtered.length} asesores</span>
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Asesor</th>
                <th>Cargo</th>
                <th>WhatsApp</th>
                <th>Especialidades</th>
                <th>Registro</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="flex">
                      <AvatarCell src={r.image_url} name={r.name} />
                      <div><div className="cell-title">{r.name}</div><div style={{ fontSize: 11.5, color: 'var(--faint)' }}></div></div>
                    </div>
                  </td>
                  <td><span className="chip">{r.position || '—'}</span></td>
                  <td>
                    <span className="flex" style={{ color: '#1eaa47', fontWeight: 600, fontSize: 13 }}>
                      <Icon name="phone" size={13} /> {r.whatsapp || '—'}
                    </span>
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    {parseSpecialties(r.specialties).map((s) => <span className="chip" key={s}>{s}</span>)}
                  </td>
                  <td className="text-muted">{fmtDate(r.created_at)}</td>
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
          {!filtered.length && <EmptyState title={q ? 'Sin coincidencias' : 'No hay asesores'} hint={q ? 'Prueba con otro término de búsqueda' : 'Agrega tu primer asesor'} />}
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
        title={editingId ? 'Editar asesor' : 'Nuevo asesor'}
        icon={<Icon name="user-male-circle" size={18} />}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="save" size={15} />} Guardar asesor
            </button>
          </>
        }
      >
        <div className="grid-2">
          <div className="field">
            <label>Nombre completo <span className="req">*</span></label>
            <input className="input" placeholder="Ej. Juan Carlos Pérez" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Cargo <span className="req">*</span></label>
            <input className="input" placeholder="Ej. Técnico Agrícola" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label><Icon name="phone" size={14} /> WhatsApp <span className="req">*</span></label>
          <input className="input" placeholder="Ej. 987654321" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
        </div>
        <div className="field">
          <label><Icon name="briefcase" size={14} /> Especialidades</label>
          <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
            {SPECIALTIES.map((s) => (
              <label className="check" key={s}>
                <input type="checkbox" checked={form.specialties.includes(s)} onChange={() => toggleSpec(s)} />
                {s}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Foto del asesor</label>
          <FileUpload value={form.image_url} onChange={(u) => setForm({ ...form, image_url: u })} />
        </div>
      </Modal>

      {ConfirmDialog}
    </>
  );
}