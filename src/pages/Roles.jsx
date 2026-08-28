import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import { Loader, ErrorState, EmptyState, Badge } from '../components/ui';
import { useAuth } from '../auth';

export default function Roles() {
  const toast = useToast();
  const { ask, ConfirmDialog } = useConfirm();
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [perms, setPerms] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ id: null, name: '', code: '', description: '', permission_codes: [] });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const canCreate = can('ROLES_CREATE');
  const canUpdate = can('ROLES_UPDATE');
  const canDelete = can('ROLES_DELETE');

  const load = () => {
    setFailed(false);
    api.get('/admin/roles').then((r) => setRows(r.data)).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, []);

  const loadPerms = () => {
    api.get('/admin/permissions').then((r) => setPerms(r.data)).catch(() => {});
  };
  useEffect(() => { loadPerms(); }, []);

  const groups = {};
  (perms || []).forEach((p) => {
    (groups[p.module] = groups[p.module] || []).push(p);
  });

  const openAdd = () => { setForm({ id: null, name: '', code: '', description: '', permission_codes: [] }); setModal(true); };
  const openEdit = (r) => {
    setForm({
      id: r.id,
      name: r.name,
      code: r.code,
      description: r.description || '',
      permission_codes: r.permission_codes || [],
    });
    setModal(true);
  };

  const togglePerm = (code) =>
    setForm((f) => ({
      ...f,
      permission_codes: f.permission_codes.includes(code)
        ? f.permission_codes.filter((c) => c !== code)
        : [...f.permission_codes, code],
    }));

  const save = async () => {
    if (!form.name.trim()) return toast.warning('El nombre es obligatorio');
    if (!form.code.trim()) return toast.warning('El código es obligatorio');
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim(),
        description: form.description,
        permission_codes: form.permission_codes,
      };
      if (form.id) {
        await api.put(`/admin/roles/${form.id}`, payload);
        toast.success('Rol actualizado');
      } else {
        await api.post('/admin/roles', payload);
        toast.success('Rol creado');
      }
      setModal(false);
      load();
      loadPerms();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const remove = async (r) => {
    const ok = await ask({ title: 'Eliminar rol', message: `¿Deseas eliminar el rol ${r.code}?`, confirmText: 'Eliminar' });
    if (!ok) return;
    try {
      await api.delete(`/admin/roles/${r.id}`);
      toast.success('Rol eliminado');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar los roles" /> : <Loader text="Cargando roles..." />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Roles y permisos</h1>
          <div className="sub">Configura qué puede hacer cada rol del sistema</div>
        </div>
        {canCreate && (
          <button className="btn btn-primary btn-lg" onClick={openAdd}><Icon name="plus" size={17} /> Nuevo Rol</button>
        )}
      </div>

      <div className="card">
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Rol</th>
                <th>Descripción</th>
                <th>Permisos</th>
                <th>Usuarios</th>
                <th>Tipo</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Rol"><div className="cell-title">{r.name}</div><div className="text-muted">{r.code}</div></td>
                  <td data-label="Descripción" className="text-muted">{r.description || '—'}</td>
                  <td data-label="Permisos" style={{ maxWidth: 320 }}>
                    <div className="flex" style={{ flexWrap: 'wrap', gap: 4 }}>
                      {(r.permission_codes || []).slice(0, 8).map((c) => <Badge key={c}>{c}</Badge>)}
                      {(r.permission_codes || []).length > 8 && (
                        <span className="text-muted" style={{ fontSize: 12 }}>+{(r.permission_codes || []).length - 8}</span>
                      )}
                    </div>
                  </td>
                  <td data-label="Usuarios">{r.user_count ?? 0}</td>
                  <td data-label="Tipo">
                    <Badge kind={r.is_system ? 'blue' : 'gray'}>{r.is_system ? 'Sistema' : 'Personalizado'}</Badge>
                  </td>
                  <td>
                    <div className="row-actions">
                      {canUpdate && (
                        <button className="btn-icon" onClick={() => openEdit(r)} title="Editar"><Icon name="edit" size={14} /></button>
                      )}
                      {canDelete && !r.is_system && (
                        <button className="btn-icon danger" onClick={() => remove(r)} title="Eliminar"><Icon name="trash" size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <EmptyState title="No hay roles" />}
        </div>
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={form.id ? 'Editar rol' : 'Nuevo rol'}
        icon={<Icon name="security-checked" size={18} />}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="save" size={15} />} Guardar rol
            </button>
          </>
        }
      >
        <div className="grid-2">
          <div className="field">
            <label>Nombre <span className="req">*</span></label>
            <input className="input" placeholder="Ej. Editor de Contenido" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Código <span className="req">*</span></label>
            <input className="input" placeholder="Ej. EDITOR_CONTENIDO" value={form.code} disabled={form.id && rows.find((x) => x.id === form.id)?.is_system} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s+/g, '_') })} />
          </div>
        </div>
        <div className="field">
          <label>Descripción</label>
          <textarea className="textarea" placeholder="Describe el alcance del rol" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>

        <div className="field">
          <label>Permisos</label>
          {Object.keys(groups).map((module) => (
            <div key={module} style={{ marginBottom: 10 }}>
              <div className="chip" style={{ marginBottom: 6 }}>{module}</div>
              <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
                {groups[module].map((p) => (
                  <label className="check" key={p.id}>
                    <input type="checkbox" checked={form.permission_codes.includes(p.code)} onChange={() => togglePerm(p.code)} />
                    {p.code}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {ConfirmDialog}
    </>
  );
}
