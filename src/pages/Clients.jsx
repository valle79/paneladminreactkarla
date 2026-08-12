import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Save, X, UserRound, Building2, RotateCcw, Phone } from 'lucide-react';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import { Toolbar, useSearch, Loader, EmptyState, ErrorState, fmtDate } from '../components/ui';

const emptyDni = { dni: '', names: '', last_names: '', address: '' };
const emptyRuc = {
  ruc: '', razonsocial: '', nombrecomercial: '', telefonos: '',
  direccion: '', departamento: '', provincia: '', distrito: '',
};

function DniTab() {
  const toast = useToast();
  const { ask, ConfirmDialog } = useConfirm();
  const [rows, setRows] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyDni);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    api.get(`/clients${showDeleted ? '?include_deleted=true' : ''}`).then((r) => setRows(r.data)).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [showDeleted]);

  const { q, setQ, filtered } = useSearch(rows || [], [(r) => r.names, (r) => r.last_names, (r) => r.dni]);

  const openAdd = () => { setEditingId(null); setForm(emptyDni); setModal(true); };
  const openEdit = (r) => { setEditingId(r.id); setForm({ dni: r.dni, names: r.names, last_names: r.last_names, address: r.address }); setModal(true); };

  const save = async () => {
    if (!form.dni || !/^\d{8}$/.test(form.dni)) return toast.warning('El DNI debe tener 8 dígitos');
    if (!form.names.trim() || !form.last_names.trim()) return toast.warning('Nombres y apellidos son obligatorios');
    setBusy(true);
    try {
      if (editingId) {
        await api.put(`/clients/${editingId}`, form);
        toast.success('Cliente actualizado');
      } else {
        await api.post('/clients', form);
        toast.success('Cliente creado');
      }
      setModal(false);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const remove = async (r) => {
    const ok = await ask({ title: 'Eliminar cliente', message: `¿Deseas eliminar a ${r.names} ${r.last_names}?`, confirmText: 'Eliminar' });
    if (!ok) return;
    try {
      await api.delete(`/clients/${r.id}`);
      toast.success('Cliente eliminado');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const restore = async (r) => {
    try {
      await api.post(`/clients/${r.id}/restore`);
      toast.success('Cliente restaurado');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar los clientes DNI" /> : <Loader text="Cargando clientes DNI..." />;

  return (
    <>
      <div className="flex" style={{ marginBottom: 16 }}>
        <label className="check"><input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Mostrar inactivos</label>
      </div>
      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar por DNI o nombre...">
          <span className="pill-count">{filtered.length} clientes</span>
          <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Agregar Cliente</button>
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>DNI</th><th>Nombres y apellidos</th><th>Dirección</th><th>Registro</th><th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={r.deleted ? { opacity: 0.55 } : {}}>
                  <td><span className="chip">{r.dni}</span></td>
                  <td><span className="cell-title">{r.names} {r.last_names}</span></td>
                  <td className="desc-cell">{r.address || '—'}</td>
                  <td className="text-muted">{fmtDate(r.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      {r.deleted ? (
                        <button className="btn-icon" onClick={() => restore(r)} title="Restaurar"><RotateCcw size={14} /></button>
                      ) : (
                        <>
                          <button className="btn-icon" onClick={() => openEdit(r)} title="Editar"><Pencil size={14} /></button>
                          <button className="btn-icon danger" onClick={() => remove(r)} title="Eliminar"><Trash2 size={14} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title={q ? 'Sin coincidencias' : 'No hay clientes'} hint="Agrega tu primer cliente con DNI" />}
        </div>
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editingId ? 'Editar cliente DNI' : 'Nuevo cliente DNI'}
        icon={<UserRound size={18} />}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><X size={15} /> Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : <Save size={15} />} Guardar</button>
          </>
        }
      >
        <div className="field">
          <label>DNI <span className="req">*</span></label>
          <input className="input" maxLength={8} placeholder="8 dígitos" value={form.dni} onChange={(e) => setForm({ ...form, dni: e.target.value.replace(/\D/g, '') })} />
        </div>
        <div className="grid-2">
          <div className="field"><label>Nombres <span className="req">*</span></label><input className="input" value={form.names} onChange={(e) => setForm({ ...form, names: e.target.value })} /></div>
          <div className="field"><label>Apellidos <span className="req">*</span></label><input className="input" value={form.last_names} onChange={(e) => setForm({ ...form, last_names: e.target.value })} /></div>
        </div>
        <div className="field"><label>Dirección</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
      </Modal>
      {ConfirmDialog}
    </>
  );
}

function RucTab() {
  const toast = useToast();
  const { ask, ConfirmDialog } = useConfirm();
  const [rows, setRows] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyRuc);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    api.get(`/clients-ruc${showDeleted ? '?include_deleted=true' : ''}`).then((r) => setRows(r.data)).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [showDeleted]);

  const { q, setQ, filtered } = useSearch(rows || [], [(r) => r.razonsocial, (r) => r.ruc, (r) => r.nombrecomercial]);

  const openAdd = () => { setEditingId(null); setForm(emptyRuc); setModal(true); };
  const openEdit = (r) => {
    setEditingId(r.id);
    setForm({
      ruc: r.ruc, razonsocial: r.razonsocial, nombrecomercial: r.nombrecomercial,
      telefonos: Array.isArray(r.telefonos) ? r.telefonos.join(', ') : r.telefonos || '',
      direccion: r.direccion, departamento: r.departamento, provincia: r.provincia, distrito: r.distrito,
    });
    setModal(true);
  };

  const save = async () => {
    if (!form.ruc || !/^\d{11}$/.test(form.ruc)) return toast.warning('El RUC debe tener 11 dígitos');
    if (!form.razonsocial.trim()) return toast.warning('La razón social es obligatoria');
    setBusy(true);
    try {
      const payload = {
        ...form,
        razonsocial: form.razonsocial.trim(),
        telefonos: form.telefonos.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (editingId) {
        await api.put(`/clients-ruc/${editingId}`, payload);
        toast.success('Empresa actualizada');
      } else {
        await api.post('/clients-ruc', payload);
        toast.success('Empresa creada');
      }
      setModal(false);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const remove = async (r) => {
    const ok = await ask({ title: 'Eliminar empresa', message: `¿Deseas eliminar a ${r.razonsocial}?`, confirmText: 'Eliminar' });
    if (!ok) return;
    try {
      await api.delete(`/clients-ruc/${r.id}`);
      toast.success('Empresa eliminada');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const restore = async (r) => {
    try {
      await api.post(`/clients-ruc/${r.id}/restore`);
      toast.success('Empresa restaurada');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar las empresas" /> : <Loader text="Cargando empresas..." />;

  return (
    <>
      <div className="flex" style={{ marginBottom: 16 }}>
        <label className="check"><input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Mostrar inactivos</label>
      </div>
      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar por RUC o razón social...">
          <span className="pill-count">{filtered.length} empresas</span>
          <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Agregar Empresa</button>
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>RUC</th><th>Razón social</th><th>Nombre comercial</th><th>Teléfonos</th><th>Ubicación</th><th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={r.deleted ? { opacity: 0.55 } : {}}>
                  <td><span className="chip">{r.ruc}</span></td>
                  <td><span className="cell-title">{r.razonsocial}</span></td>
                  <td className="text-muted">{r.nombrecomercial || '—'}</td>
                  <td>
                    <span className="flex" style={{ color: '#1eaa47', fontSize: 12.5 }}>
                      <Phone size={12} /> {(Array.isArray(r.telefonos) ? r.telefonos.join(', ') : r.telefonos) || '—'}
                    </span>
                  </td>
                  <td className="text-muted" style={{ fontSize: 12.5 }}>{[r.departamento, r.provincia, r.distrito].filter(Boolean).join(' · ') || '—'}</td>
                  <td>
                    <div className="row-actions">
                      {r.deleted ? (
                        <button className="btn-icon" onClick={() => restore(r)} title="Restaurar"><RotateCcw size={14} /></button>
                      ) : (
                        <>
                          <button className="btn-icon" onClick={() => openEdit(r)} title="Editar"><Pencil size={14} /></button>
                          <button className="btn-icon danger" onClick={() => remove(r)} title="Eliminar"><Trash2 size={14} /></button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title={q ? 'Sin coincidencias' : 'No hay empresas'} hint="Agrega tu primera empresa" />}
        </div>
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editingId ? 'Editar empresa' : 'Nueva empresa'}
        icon={<Building2 size={18} />}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><X size={15} /> Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : <Save size={15} />} Guardar</button>
          </>
        }
      >
        <div className="grid-2">
          <div className="field"><label>RUC <span className="req">*</span></label><input className="input" maxLength={11} placeholder="11 dígitos" value={form.ruc} onChange={(e) => setForm({ ...form, ruc: e.target.value.replace(/\D/g, '') })} /></div>
          <div className="field"><label>Razón social <span className="req">*</span></label><input className="input" value={form.razonsocial} onChange={(e) => setForm({ ...form, razonsocial: e.target.value })} /></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>Nombre comercial</label><input className="input" value={form.nombrecomercial} onChange={(e) => setForm({ ...form, nombrecomercial: e.target.value })} /></div>
          <div className="field"><label>Teléfonos (separados por coma)</label><input className="input" placeholder="964123456, 064123456" value={form.telefonos} onChange={(e) => setForm({ ...form, telefonos: e.target.value })} /></div>
        </div>
        <div className="field"><label>Dirección</label><input className="input" value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} /></div>
        <div className="grid-3">
          <div className="field"><label>Departamento</label><input className="input" value={form.departamento} onChange={(e) => setForm({ ...form, departamento: e.target.value })} /></div>
          <div className="field"><label>Provincia</label><input className="input" value={form.provincia} onChange={(e) => setForm({ ...form, provincia: e.target.value })} /></div>
          <div className="field"><label>Distrito</label><input className="input" value={form.distrito} onChange={(e) => setForm({ ...form, distrito: e.target.value })} /></div>
        </div>
      </Modal>
      {ConfirmDialog}
    </>
  );
}

export default function Clients() {
  const [tab, setTab] = useState('dni');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Clientes</h1>
          <div className="sub">Personas naturales (DNI) y empresas (RUC)</div>
        </div>
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'dni' ? 'active' : ''}`} onClick={() => setTab('dni')}><UserRound size={15} /> Personas (DNI)</button>
        <button className={`tab ${tab === 'ruc' ? 'active' : ''}`} onClick={() => setTab('ruc')}><Building2 size={15} /> Empresas (RUC)</button>
      </div>
      {tab === 'dni' ? <DniTab /> : <RucTab />}
    </>
  );
}