import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import { Toolbar, useSearch, useListReload, Loader, EmptyState, ErrorState, fmtDate } from '../components/ui';
import { Pagination } from '../components/Pagination';

const emptyDni = { dni: '', names: '', last_names: '', address: '', phone: '' };
const emptyRuc = {
  ruc: '', razonsocial: '', nombrecomercial: '', telefonos: '',
  direccion: '', departamento: '', provincia: '', distrito: '',
  ubigeo: '', estado: '', condicion: '',
  via_tipo: '', via_nombre: '', zona_codigo: '', zona_tipo: '',
  numero: '', interior: '', lote: '', dpto: '', manzana: '', kilometro: '',
  es_agente_retencion: false, es_buen_contribuyente: false, locales_anexos: '',
};

function DniTab() {
  const toast = useToast();
  const { ask, ConfirmDialog } = useConfirm();
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyDni);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [consulting, setConsulting] = useState(false);
  const [source, setSource] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);

  const load = () => {
    setFailed(false);
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      ...(showDeleted && { include_deleted: 'true' })
    });
    api.get(`/clients?${params}`).then((r) => setData(r.data)).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [showDeleted, page]);

  const rows = data?.items || [];
  const pagination = data?.pagination;

  const { q, setQ, filtered } = useSearch(rows, [(r) => r.names, (r) => r.last_names, (r) => r.dni]);
  const reloadList = useListReload(page, setPage, load, editingId);

  const openAdd = () => { setEditingId(null); setForm(emptyDni); setSource(''); setModal(true); };
  const openEdit = (r) => { setEditingId(r.id); setForm({ dni: r.dni, names: r.names, last_names: r.last_names, address: r.address, phone: r.phone || '' }); setSource(''); setModal(true); };

  const consultarDni = async () => {
    const dni = form.dni.replace(/\D/g, '');
    if (!/^\d{8}$/.test(dni)) return toast.warning('Ingresa un DNI de 8 dígitos para consultar en RENIEC');
    setConsulting(true);
    setSource('');
    try {
      const { data } = await api.post('/consultar/dni', { dni });
      setForm((f) => ({
        ...f,
        names: data.nombres || f.names,
        last_names: data.apellidos || f.last_names,
        address: data.direccion || f.address,
      }));
      setSource(data.fuente || 'RENIEC');
    } catch (e) { toast.error(errMsg(e)); } finally { setConsulting(false); }
  };

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
      reloadList();
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

  if (!data) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar los clientes DNI" /> : <Loader text="Cargando clientes DNI..." />;

  return (
    <>
      <div className="flex" style={{ marginBottom: 16 }}>
        <label className="check"><input type="checkbox" checked={showDeleted} onChange={(e) => { setShowDeleted(e.target.checked); setPage(1); }} /> Mostrar inactivos</label>
      </div>
      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar por DNI o nombre...">
          <span className="pill-count">{pagination?.total || 0} clientes</span>
          <button className="btn btn-primary" onClick={openAdd}><Icon name="plus" size={16} /> Agregar Cliente</button>
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
                  <td data-label="DNI"><span className="chip">{r.dni}</span></td>
                  <td data-label="Nombres y apellidos"><span className="cell-title">{r.names} {r.last_names}</span></td>
                  <td data-label="Dirección" className="desc-cell">{r.address || '—'}</td>
                  <td data-label="Registro" className="text-muted">{fmtDate(r.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      {r.deleted ? (
                        <button className="btn-icon" onClick={() => restore(r)} title="Restaurar"><Icon name="undo" size={14} /></button>
                      ) : (
                        <>
<button className="btn-icon" onClick={() => openEdit(r)} title="Editar"><Icon name="edit" size={14} /></button>
            <button className="btn-icon danger" onClick={() => remove(r)} title="Eliminar"><Icon name="trash" size={14} /></button>
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
        title={editingId ? 'Editar cliente DNI' : 'Nuevo cliente DNI'}
        icon={<Icon name="user-male-circle" size={18} />}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="save" size={15} />} Guardar</button>
          </>
        }
      >
        <div className="field">
          <label>DNI <span className="req">*</span></label>
          <div className="flex" style={{ gap: 8 }}>
            <input className="input" maxLength={8} placeholder="8 dígitos" value={form.dni} onChange={(e) => setForm({ ...form, dni: e.target.value.replace(/\D/g, '') })} />
            <button type="button" className="btn btn-yellow" style={{ minWidth: 120, flexShrink: 0 }} onClick={consultarDni} disabled={consulting}>
              {consulting ? <span className="spinner" /> : <Icon name="checked-user-male" size={15} />} Consultar
            </button>
          </div>
          {source && <div className="hint" style={{ marginTop: 4 }}>Datos obtenidos de {source}</div>}
        </div>
        <div className="grid-2">
          <div className="field"><label>Nombres <span className="req">*</span></label><input className="input" value={form.names} onChange={(e) => setForm({ ...form, names: e.target.value })} /></div>
          <div className="field"><label>Apellidos <span className="req">*</span></label><input className="input" value={form.last_names} onChange={(e) => setForm({ ...form, last_names: e.target.value })} /></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>Dirección</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="field"><label>Teléfono / WhatsApp</label><input className="input" maxLength={9} placeholder="Ej. 987654321" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })} /></div>
        </div>
        <div className="hint">El teléfono permite enviar los documentos (boleta, factura, proforma) al cliente por WhatsApp.</div>
      </Modal>
      {ConfirmDialog}
    </>
  );
}

function RucTab() {
  const toast = useToast();
  const { ask, ConfirmDialog } = useConfirm();
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyRuc);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [consulting, setConsulting] = useState(false);
  const [source, setSource] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);

  const load = () => {
    setFailed(false);
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      ...(showDeleted && { include_deleted: 'true' })
    });
    api.get(`/clients-ruc?${params}`).then((r) => setData(r.data)).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [showDeleted, page]);

  const rows = data?.items || [];
  const pagination = data?.pagination;

  const { q, setQ, filtered } = useSearch(rows, [(r) => r.razonsocial, (r) => r.ruc, (r) => r.nombrecomercial]);
  const reloadList = useListReload(page, setPage, load, editingId);

  const openAdd = () => { setEditingId(null); setForm(emptyRuc); setSource(''); setModal(true); };
  const openEdit = (r) => {
    setEditingId(r.id);
    setForm({
      ruc: r.ruc, razonsocial: r.razonsocial, nombrecomercial: r.nombrecomercial,
      telefonos: Array.isArray(r.telefonos) ? r.telefonos.join(', ') : r.telefonos || '',
      direccion: r.direccion, departamento: r.departamento, provincia: r.provincia, distrito: r.distrito,
      ubigeo: r.ubigeo, estado: r.estado, condicion: r.condicion,
      via_tipo: r.via_tipo, via_nombre: r.via_nombre, zona_codigo: r.zona_codigo, zona_tipo: r.zona_tipo,
      numero: r.numero, interior: r.interior, lote: r.lote, dpto: r.dpto, manzana: r.manzana, kilometro: r.kilometro,
      es_agente_retencion: !!r.es_agente_retencion, es_buen_contribuyente: !!r.es_buen_contribuyente,
      locales_anexos: Array.isArray(r.locales_anexos) ? JSON.stringify(r.locales_anexos) : (r.locales_anexos || ''),
    });
    setSource('');
    setModal(true);
  };

  const consultarRuc = async () => {
    const ruc = form.ruc.replace(/\D/g, '');
    if (!/^\d{11}$/.test(ruc)) return toast.warning('Ingresa un RUC de 11 dígitos para consultar en SUNAT');
    setConsulting(true);
    setSource('');
    try {
      const { data } = await api.post('/consultar/ruc', { ruc });
      setForm((f) => ({
        ...f,
        ruc: data.numero_documento || f.ruc,
        razonsocial: data.razon_social || f.razonsocial,
        nombrecomercial: data.nombre_comercial || f.nombrecomercial,
        direccion: data.direccion || f.direccion,
        departamento: data.departamento || f.departamento,
        provincia: data.provincia || f.provincia,
        distrito: data.distrito || f.distrito,
        ubigeo: data.ubigeo || f.ubigeo,
        estado: data.estado || f.estado,
        condicion: data.condicion || f.condicion,
        via_tipo: data.via_tipo || f.via_tipo,
        via_nombre: data.via_nombre || f.via_nombre,
        zona_codigo: data.zona_codigo || f.zona_codigo,
        zona_tipo: data.zona_tipo || f.zona_tipo,
        numero: data.numero || f.numero,
        interior: data.interior || f.interior,
        lote: (data.lote && data.lote !== '-') ? data.lote : f.lote,
        dpto: (data.dpto && data.dpto !== '-') ? data.dpto : f.dpto,
        manzana: (data.manzana && data.manzana !== '-') ? data.manzana : f.manzana,
        kilometro: (data.kilometro && data.kilometro !== '-') ? data.kilometro : f.kilometro,
        es_agente_retencion: !!data.es_agente_retencion,
        es_buen_contribuyente: !!data.es_buen_contribuyente,
        locales_anexos: Array.isArray(data.locales_anexos) ? JSON.stringify(data.locales_anexos) : (data.locales_anexos || ''),
      }));
      setSource(data.fuente || 'SUNAT');
    } catch (e) { toast.error(errMsg(e)); } finally { setConsulting(false); }
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
      reloadList();
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

  if (!data) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar las empresas" /> : <Loader text="Cargando empresas..." />;

  return (
    <>
      <div className="flex" style={{ marginBottom: 16 }}>
        <label className="check"><input type="checkbox" checked={showDeleted} onChange={(e) => { setShowDeleted(e.target.checked); setPage(1); }} /> Mostrar inactivos</label>
      </div>
      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar por RUC o razón social...">
          <span className="pill-count">{pagination?.total || 0} empresas</span>
          <button className="btn btn-primary" onClick={openAdd}><Icon name="plus" size={16} /> Agregar Empresa</button>
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
                  <td data-label="RUC"><span className="chip">{r.ruc}</span></td>
                  <td data-label="Razón social"><span className="cell-title">{r.razonsocial}</span></td>
                  <td data-label="Nombre comercial" className="text-muted">{r.nombrecomercial || '—'}</td>
                  <td data-label="Teléfonos">
                    <span className="flex" style={{ color: '#1eaa47', fontSize: 12.5 }}>
                      <Icon name="phone" size={12} /> {(Array.isArray(r.telefonos) ? r.telefonos.join(', ') : r.telefonos) || '—'}
                    </span>
                  </td>
                  <td data-label="Ubicación" className="text-muted" style={{ fontSize: 12.5 }}>{[r.departamento, r.provincia, r.distrito].filter(Boolean).join(' · ') || '—'}</td>
                  <td>
                    <div className="row-actions">
                      {r.deleted ? (
                        <button className="btn-icon" onClick={() => restore(r)} title="Restaurar"><Icon name="undo" size={14} /></button>
                      ) : (
                        <>
<button className="btn-icon" onClick={() => openEdit(r)} title="Editar"><Icon name="edit" size={14} /></button>
            <button className="btn-icon danger" onClick={() => remove(r)} title="Eliminar"><Icon name="trash" size={14} /></button>
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
        title={editingId ? 'Editar empresa' : 'Nueva empresa'}
        icon={<Icon name="building" size={18} />}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="save" size={15} />} Guardar</button>
          </>
        }
      >
        <div className="field">
          <label>RUC <span className="req">*</span></label>
          <div className="flex" style={{ gap: 8 }}>
            <input className="input" maxLength={11} placeholder="11 dígitos" value={form.ruc} onChange={(e) => setForm({ ...form, ruc: e.target.value.replace(/\D/g, '') })} />
            <button type="button" className="btn btn-yellow" style={{ minWidth: 120, flexShrink: 0 }} onClick={consultarRuc} disabled={consulting}>
              {consulting ? <span className="spinner" /> : <Icon name="checked-user-male" size={15} />} Consultar
            </button>
          </div>
          {source && <div className="hint" style={{ marginTop: 4 }}>Datos obtenidos de {source}</div>}
        </div>
        <div className="grid-2">
          <div className="field"><label>Razón social <span className="req">*</span></label><input className="input" value={form.razonsocial} onChange={(e) => setForm({ ...form, razonsocial: e.target.value })} /></div>
          <div className="field"><label>Nombre comercial</label><input className="input" value={form.nombrecomercial} onChange={(e) => setForm({ ...form, nombrecomercial: e.target.value })} /></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>Teléfonos (separados por coma)</label><input className="input" placeholder="964123456, 064123456" value={form.telefonos} onChange={(e) => setForm({ ...form, telefonos: e.target.value })} /></div>
          <div className="field"><label>Dirección</label><input className="input" value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} /></div>
        </div>
        <div className="grid-3">
          <div className="field"><label>Departamento</label><input className="input" value={form.departamento} onChange={(e) => setForm({ ...form, departamento: e.target.value })} /></div>
          <div className="field"><label>Provincia</label><input className="input" value={form.provincia} onChange={(e) => setForm({ ...form, provincia: e.target.value })} /></div>
          <div className="field"><label>Distrito</label><input className="input" value={form.distrito} onChange={(e) => setForm({ ...form, distrito: e.target.value })} /></div>
        </div>
        <div className="grid-3">
          <div className="field"><label>Ubigeo</label><input className="input" value={form.ubigeo} onChange={(e) => setForm({ ...form, ubigeo: e.target.value })} /></div>
          <div className="field"><label>Estado</label><input className="input" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} /></div>
          <div className="field"><label>Condición</label><input className="input" value={form.condicion} onChange={(e) => setForm({ ...form, condicion: e.target.value })} /></div>
        </div>
        <div className="grid-3">
          <div className="field"><label>Tipo de vía</label><input className="input" value={form.via_tipo} onChange={(e) => setForm({ ...form, via_tipo: e.target.value })} /></div>
          <div className="field"><label>Nombre de vía</label><input className="input" value={form.via_nombre} onChange={(e) => setForm({ ...form, via_nombre: e.target.value })} /></div>
          <div className="field"><label>Número</label><input className="input" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></div>
        </div>
        <div className="grid-4">
          <div className="field"><label>Interior</label><input className="input" value={form.interior} onChange={(e) => setForm({ ...form, interior: e.target.value })} /></div>
          <div className="field"><label>Lote</label><input className="input" value={form.lote} onChange={(e) => setForm({ ...form, lote: e.target.value })} /></div>
          <div className="field"><label>Dpto</label><input className="input" value={form.dpto} onChange={(e) => setForm({ ...form, dpto: e.target.value })} /></div>
          <div className="field"><label>Manzana</label><input className="input" value={form.manzana} onChange={(e) => setForm({ ...form, manzana: e.target.value })} /></div>
        </div>
        <div className="grid-4">
          <div className="field"><label>Kilómetro</label><input className="input" value={form.kilometro} onChange={(e) => setForm({ ...form, kilometro: e.target.value })} /></div>
          <div className="field"><label>Código de zona</label><input className="input" value={form.zona_codigo} onChange={(e) => setForm({ ...form, zona_codigo: e.target.value })} /></div>
          <div className="field"><label>Tipo de zona</label><input className="input" value={form.zona_tipo} onChange={(e) => setForm({ ...form, zona_tipo: e.target.value })} /></div>
          <div className="field"><label>Locales anexos</label><input className="input" placeholder="JSON o texto" value={form.locales_anexos} onChange={(e) => setForm({ ...form, locales_anexos: e.target.value })} /></div>
        </div>
        <div className="grid-2" style={{ marginTop: 8 }}>
          <label className="check"><input type="checkbox" checked={form.es_agente_retencion} onChange={(e) => setForm({ ...form, es_agente_retencion: e.target.checked })} /> Agente de retención</label>
          <label className="check"><input type="checkbox" checked={form.es_buen_contribuyente} onChange={(e) => setForm({ ...form, es_buen_contribuyente: e.target.checked })} /> Buen contribuyente</label>
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
<button className={`tab ${tab === 'dni' ? 'active' : ''}`} onClick={() => setTab('dni')}><Icon name="user-male-circle" size={15} /> Personas (DNI)</button>
            <button className={`tab ${tab === 'ruc' ? 'active' : ''}`} onClick={() => setTab('ruc')}><Icon name="building" size={15} /> Empresas (RUC)</button>
      </div>
      {tab === 'dni' ? <DniTab /> : <RucTab />}
    </>
  );
}