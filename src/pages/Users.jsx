import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import { Toolbar, Loader, ErrorState, EmptyState, Badge, fmtDate, fmtDateTime } from '../components/ui';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../auth';

export default function Users() {
  const toast = useToast();
  const { ask, ConfirmDialog } = useConfirm();
  const { user: me, can, refreshUser } = useAuth();
  const [rows, setRows] = useState(null);
  const [roles, setRoles] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role_ids: [] });
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [pagination, setPagination] = useState(null);
  const [q, setQ] = useState('');
  const [resetUser, setResetUser] = useState(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const canCreate = can('USERS_CREATE');
  const canUpdate = can('USERS_UPDATE');
  const canDelete = can('USERS_DELETE');

  const load = () => {
    setFailed(false);
    const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
    if (q.trim()) params.set('q', q.trim());
    api.get(`/admin/users?${params}`).then((r) => {
      setRows(r.data.items);
      setPagination(r.data.pagination);
    }).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [page, q]);

  const loadRoles = () => {
    api.get('/admin/roles').then((r) => setRoles(r.data)).catch(() => {});
  };
  useEffect(() => { loadRoles(); }, []);

  const openAdd = () => { setEditingId(null); setForm({ name: '', email: '', password: '', role_ids: [] }); setModal(true); };
  const openEdit = (r) => {
    setEditingId(r.id);
    setForm({
      name: r.name || '',
      email: r.email || '',
      password: '',
      role_ids: (r.roles || []).map((x) => x.id),
      active: r.active,
    });
    setModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast.warning('El nombre es obligatorio');
    if (!form.email.trim()) return toast.warning('El email es obligatorio');
    if (!editingId && !form.password) return toast.warning('La contraseña es obligatoria');
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        role_ids: form.role_ids,
      };
      if (form.password) payload.password = form.password;
      if (form.active !== undefined) payload.active = form.active;
      if (editingId) {
        await api.put(`/admin/users/${editingId}`, payload);
        toast.success('Usuario actualizado');
      } else {
        await api.post('/admin/users', payload);
        toast.success('Usuario creado');
      }
      setModal(false);
      if (me?.id === editingId) await refreshUser();
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const deactivate = async (r) => {
    const ok = await ask({
      title: r.active ? 'Desactivar usuario' : 'Activar usuario',
      message: r.active
        ? `¿Deseas desactivar a ${r.name}? Perderá acceso al sistema.`
        : `¿Deseas reactivar a ${r.name}?`,
      confirmText: r.active ? 'Desactivar' : 'Activar',
    });
    if (!ok) return;
    try {
      await api.put(`/admin/users/${r.id}`, { active: !r.active });
      toast.success('Estado actualizado');
      if (me?.id === r.id) await refreshUser();
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const openReset = (r) => { setResetUser(r); setResetPwd(''); };
  const doReset = async () => {
    if (!resetPwd || resetPwd.length < 6) return toast.warning('La contraseña debe tener al menos 6 caracteres');
    setResetBusy(true);
    try {
      await api.post(`/admin/users/${resetUser.id}/reset-password`, { password: resetPwd });
      toast.success('Contraseña restablecida');
      setResetUser(null);
    } catch (e) { toast.error(errMsg(e)); } finally { setResetBusy(false); }
  };

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar los usuarios" /> : <Loader text="Cargando usuarios..." />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Usuarios</h1>
          <div className="sub">Gestión de accesos, roles y permisos del sistema</div>
        </div>
        {canCreate && (
          <button className="btn btn-primary btn-lg" onClick={openAdd}><Icon name="plus" size={17} /> Nuevo Usuario</button>
        )}
      </div>

      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar por nombre o email...">
          <span className="pill-count">{pagination?.total || 0} usuarios</span>
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Último acceso</th>
                <th>Registro</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Usuario">
                    <div className="flex">
                      <span className="avatar">{(r.name || '?').charAt(0).toUpperCase()}</span>
                      <div className="cell-title">{r.name}</div>
                    </div>
                  </td>
                  <td data-label="Email">{r.email}</td>
                  <td data-label="Rol">
                    {(r.roles || []).map((x) => (
                      <Badge key={x.id} kind={x.code === 'SUPER_ADMIN' ? 'green' : x.is_system ? 'blue' : 'gray'}>{x.code}</Badge>
                    ))}
                  </td>
                  <td data-label="Estado">
                    <Badge kind={r.active ? 'green' : 'red'}>{r.active ? 'Activo' : 'Inactivo'}</Badge>
                  </td>
                  <td data-label="Último acceso" className="text-muted">{fmtDateTime(r.last_login_at)}</td>
                  <td data-label="Registro" className="text-muted">{fmtDate(r.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      {canUpdate && (
                        <>
                          <button className="btn-icon" onClick={() => r.id !== me?.id && deactivate(r)} title={r.active ? 'Desactivar' : 'Activar'} disabled={r.id === me?.id}>
                            <Icon name={r.active ? 'cancel' : 'checkmark'} size={14} />
                          </button>
                          <button className="btn-icon" onClick={() => openReset(r)} title="Restablecer contraseña"><Icon name="lock" size={14} /></button>
                          <button className="btn-icon" onClick={() => openEdit(r)} title="Editar"><Icon name="edit" size={14} /></button>
                        </>
                      )}
                      {canDelete && r.id !== me?.id && (
                        <button className="btn-icon danger" onClick={() => deactivate(r)} title="Desactivar"><Icon name="trash" size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <EmptyState title="No hay usuarios" hint="Crea el primer usuario para comenzar" />}
        </div>
        {pagination && pagination.total_pages > 1 && (
          <Pagination currentPage={pagination.page} totalPages={pagination.total_pages} totalItems={pagination.total} limit={pagination.limit} onPageChange={setPage} />
        )}
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editingId ? 'Editar usuario' : 'Nuevo usuario'}
        icon={<Icon name="user-male-circle" size={18} />}
        size="md"
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
          <label>Nombre completo <span className="req">*</span></label>
          <input className="input" placeholder="Ej. Luis Pérez" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label>Email <span className="req">*</span></label>
          <input className="input" type="email" placeholder="usuario@iqueno.sac" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="field">
          <label>{editingId ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña'} <span className="req">{!editingId && '*'}</span></label>
          <input className="input" type="password" placeholder="Mínimo 6 caracteres" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div className="field">
          <label>Rol(es)</label>
          <div className="flex" style={{ flexWrap: 'wrap', gap: 8 }}>
            {roles.map((x) => (
              <label className="check" key={x.id}>
                <input
                  type="checkbox"
                  checked={form.role_ids.includes(x.id)}
                  onChange={() => setForm((f) => ({
                    ...f,
                    role_ids: f.role_ids.includes(x.id) ? f.role_ids.filter((i) => i !== x.id) : [...f.role_ids, x.id],
                  }))}
                />
                {x.code}
              </label>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!resetUser}
        onClose={() => setResetUser(null)}
        title={`Restablecer contraseña`}
        icon={<Icon name="lock" size={18} />}
        size="sm"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setResetUser(null)}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-primary" onClick={doReset} disabled={resetBusy}>
              {resetBusy ? <span className="spinner" /> : <Icon name="save" size={15} />} Guardar
            </button>
          </>
        }
      >
        <p style={{ fontSize: 14, color: 'var(--ink)', marginBottom: 12 }}>
          Nueva contraseña para <b>{resetUser?.name}</b>
        </p>
        <div className="field">
          <input className="input" type="password" placeholder="Mínimo 6 caracteres" value={resetPwd} onChange={(e) => setResetPwd(e.target.value)} />
        </div>
        <div className="hint">El usuario deberá usar esta nueva contraseña en su próximo inicio de sesión.</div>
      </Modal>

      {ConfirmDialog}
    </>
  );
}
