import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import {
  Toolbar, useSearch, useListReload, Loader, EmptyState, ErrorState, fmtDate, Badge,
} from '../components/ui';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../auth';

const SEARCH_KEYS = [
  (r) => r.razon_social,
  (r) => r.nombre_comercial,
  (r) => r.numero_documento,
  (r) => r.contacto,
  (r) => r.email,
];

const emptyForm = {
  tipo_proveedor: 'NACIONAL',
  tipo_documento: 'RUC',
  numero_documento: '',
  razon_social: '',
  nombre_comercial: '',
  pais: 'Perú',
  direccion: '',
  ciudad: '',
  departamento: '',
  telefono: '',
  email: '',
  contacto: '',
  moneda_principal: 'PEN',
  condiciones_pago: '',
  banco: '',
  numero_cuenta: '',
  swift: '',
  estado: 'ACTIVO',
  observaciones: '',
};

export default function Suppliers() {
  const toast = useToast();
  const { can } = useAuth();
  const { ask, ConfirmDialog } = useConfirm();

  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(12);
  const [pagination, setPagination] = useState(null);
  const [tipo, setTipo] = useState('');
  const [pais, setPais] = useState('');

  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [consulting, setConsulting] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const [view, setView] = useState(null);

  const load = () => {
    setFailed(false);
    const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
    if (tipo) params.set('tipo', tipo);
    if (pais) params.set('pais', pais);
    api.get(`/suppliers?${params}`)
      .then((r) => { setRows(r.data.items); setPagination(r.data.pagination); })
      .catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [page, tipo, pais]);

  const reloadList = useListReload(page, setPage, load, editingId);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setModal(true);
  };
  const openEdit = (s) => {
    setEditingId(s.id);
    setForm({
      ...emptyForm,
      ...s,
      tipo_documento: s.tipo_documento || 'RUC',
      numero_documento: s.numero_documento || '',
    });
    setModal(true);
  };

  const validate = () => {
    if (!form.razon_social.trim()) return toast.warning('La razón social es obligatoria');
    if (form.tipo_proveedor === 'NACIONAL' && !form.numero_documento.trim())
      return toast.warning('El número de documento es obligatorio para proveedores nacionales');
    return true;
  };

  const consultarRuc = async () => {
    const ruc = form.numero_documento.replace(/\D/g, '');
    if (!/^\d{11}$/.test(ruc)) return toast.warning('Ingresa un RUC de 11 dígitos');
    setConsulting(true);
    try {
      const { data } = await api.post('/consultar/ruc', { ruc });
      setForm((f) => ({
        ...f,
        razon_social: data.razonSocial || data.nombre || f.razon_social,
        nombre_comercial: data.nombreComercial || f.nombre_comercial,
        direccion: data.direccion || f.direccion,
        departamento: data.departamento || f.departamento,
        provincia: data.provincia || f.provincia,
        estado: data.estado === 'ACTIVO' ? 'ACTIVO' : 'INACTIVO',
      }));
      toast.success('Datos obtenidos de SUNAT');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setConsulting(false);
    }
  };

  const save = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      const payload = {
        tipo_proveedor: form.tipo_proveedor,
        tipo_documento: form.tipo_documento,
        numero_documento: form.numero_documento || null,
        razon_social: form.razon_social.trim(),
        nombre_comercial: form.nombre_comercial || null,
        pais: form.pais || null,
        direccion: form.direccion || null,
        ciudad: form.ciudad || null,
        departamento: form.departamento || null,
        telefono: form.telefono || null,
        email: form.email || null,
        contacto: form.contacto || null,
        moneda_principal: form.moneda_principal || 'PEN',
        condiciones_pago: form.condiciones_pago || null,
        banco: form.banco || null,
        numero_cuenta: form.numero_cuenta || null,
        swift: form.swift || null,
        estado: form.estado,
        observaciones: form.observaciones || null,
      };
      if (editingId) {
        await api.put(`/suppliers/${editingId}`, payload);
        toast.success('Proveedor actualizado');
      } else {
        await api.post('/suppliers', payload);
        toast.success('Proveedor registrado correctamente');
      }
      setModal(false);
      reloadList();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s) => {
    const ok = await ask({
      title: 'Eliminar proveedor',
      message: `¿Deseas eliminar el proveedor "${s.razon_social}"?`,
      confirmText: 'Eliminar',
    });
    if (!ok) return;
    try {
      await api.delete(`/suppliers/${s.id}`);
      toast.success('Proveedor eliminado');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const openView = (s) => {
    api.get(`/suppliers/${s.id}`)
      .then((r) => setView(r.data))
      .catch((e) => toast.error(errMsg(e)));
  };

  const { q, setQ, filtered } = useSearch(rows || [], SEARCH_KEYS);

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar los proveedores" /> : <Loader text="Cargando proveedores..." />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Proveedores</h1>
          <div className="sub">Proveedores nacionales y extranjeros del departamento de compras</div>
        </div>
        {can('SUPPLIERS_CREATE') && (
          <button className="btn btn-primary btn-lg" onClick={openAdd}><Icon name="plus" size={17} /> Nuevo proveedor</button>
        )}
      </div>

      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar por razón social, RUC, contacto o email...">
          <select className="select" style={{ width: 'auto' }} value={tipo} onChange={(e) => { setTipo(e.target.value); setPage(1); }}>
            <option value="">Todos los tipos</option>
            <option value="NACIONAL">Nacional</option>
            <option value="EXTRANJERO">Extranjero</option>
          </select>
          <input
            className="input"
            style={{ width: 150 }}
            placeholder="País…"
            value={pais}
            onChange={(e) => { setPais(e.target.value); setPage(1); }}
          />
          <span className="pill-count">{filtered.length} proveedores</span>
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Tipo</th>
                <th>Documento</th>
                <th>País</th>
                <th>Contacto</th>
                <th>Compras</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td data-label="Proveedor" style={{ maxWidth: 240 }}>
                    <div className="cell-title">{s.razon_social}</div>
                    {s.nombre_comercial && <div className="text-muted" style={{ fontSize: 12 }}>{s.nombre_comercial}</div>}
                  </td>
                  <td data-label="Tipo">
                    <Badge kind={s.tipo_proveedor === 'NACIONAL' ? 'green' : 'blue'}>{s.tipo_proveedor}</Badge>
                  </td>
                  <td data-label="Documento" className="text-muted">
                    {s.tipo_documento ? `${s.tipo_documento} ` : ''}{s.numero_documento || '—'}
                  </td>
                  <td data-label="País" className="text-muted">{s.pais || '—'}</td>
                  <td data-label="Contacto" className="text-muted">
                    {s.contacto || '—'}
                    {s.telefono && <div className="text-muted" style={{ fontSize: 12 }}>{s.telefono}</div>}
                  </td>
                  <td data-label="Compras"><Badge kind="gray">{s.purchases_count || 0}</Badge></td>
                  <td data-label="Estado">
                    <Badge kind={s.estado === 'ACTIVO' ? 'green' : 'red'}>{s.estado || '—'}</Badge>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-icon" onClick={() => openView(s)} title="Ver detalle"><Icon name="visible" size={14} /></button>
                      {can('SUPPLIERS_UPDATE') && <button className="btn-icon" onClick={() => openEdit(s)} title="Editar"><Icon name="edit" size={14} /></button>}
                      {can('SUPPLIERS_DELETE') && <button className="btn-icon danger" onClick={() => remove(s)} title="Eliminar"><Icon name="trash" size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title={q || tipo || pais ? 'Sin coincidencias' : 'No hay proveedores'} hint="Registra tu primer proveedor" />}
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

      {/* Formulario proveedor */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editingId ? 'Editar proveedor' : 'Nuevo proveedor'}
        icon={<Icon name="building" size={18} />}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="save" size={15} />} Guardar proveedor
            </button>
          </>
        }
      >
        <div className="grid-3">
          <div className="field">
            <label>Tipo de proveedor <span className="req">*</span></label>
            <select className="select" value={form.tipo_proveedor} onChange={(e) => setField('tipo_proveedor', e.target.value)}>
              <option value="NACIONAL">Nacional</option>
              <option value="EXTRANJERO">Extranjero</option>
            </select>
          </div>
          <div className="field">
            <label>Tipo de documento</label>
            <select className="select" value={form.tipo_documento} onChange={(e) => setField('tipo_documento', e.target.value)}>
              <option value="RUC">RUC</option>
              <option value="DNI">DNI</option>
              <option value="TAX ID">TAX ID</option>
              <option value="OTRO">Otro</option>
            </select>
          </div>
          <div className="field">
            <label>N° documento {form.tipo_proveedor === 'NACIONAL' && <span className="req">*</span>}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input 
                className="input" 
                placeholder={form.tipo_proveedor === 'NACIONAL' ? 'RUC de 11 dígitos' : 'Tax ID / RFC / NIT'} 
                value={form.numero_documento} 
                onChange={(e) => setField('numero_documento', e.target.value.replace(/\D/g, ''))} 
                maxLength={form.tipo_documento === 'RUC' ? 11 : undefined}
              />
              {form.tipo_documento === 'RUC' && form.tipo_proveedor === 'NACIONAL' && (
                <button 
                  type="button" 
                  className="btn btn-yellow" 
                  style={{ minWidth: 120, flexShrink: 0 }} 
                  onClick={consultarRuc} 
                  disabled={consulting}
                >
                  {consulting ? <span className="spinner" /> : <Icon name="building" size={15} />} Consultar
                </button>
              )}
            </div>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Razón social <span className="req">*</span></label>
            <input className="input" placeholder="Nombre legal del proveedor" value={form.razon_social} onChange={(e) => setField('razon_social', e.target.value)} />
          </div>
          <div className="field">
            <label>Nombre comercial</label>
            <input className="input" placeholder="Opcional" value={form.nombre_comercial} onChange={(e) => setField('nombre_comercial', e.target.value)} />
          </div>
        </div>

        <div className="grid-3">
          <div className="field">
            <label>País</label>
            <input className="input" placeholder="Ej. Perú, China, Estados Unidos" value={form.pais} onChange={(e) => setField('pais', e.target.value)} />
          </div>
          <div className="field">
            <label>Ciudad</label>
            <input className="input" value={form.ciudad} onChange={(e) => setField('ciudad', e.target.value)} />
          </div>
          <div className="field">
            <label>Departamento</label>
            <input className="input" value={form.departamento} onChange={(e) => setField('departamento', e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: 'span 3' }}>
            <label>Dirección</label>
            <input className="input" value={form.direccion} onChange={(e) => setField('direccion', e.target.value)} />
          </div>
        </div>

        <div className="grid-3">
          <div className="field">
            <label>Contacto</label>
            <input className="input" value={form.contacto} onChange={(e) => setField('contacto', e.target.value)} />
          </div>
          <div className="field">
            <label>Teléfono</label>
            <input className="input" value={form.telefono} onChange={(e) => setField('telefono', e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
          </div>
        </div>

        <div className="grid-3">
          <div className="field">
            <label>Moneda principal</label>
            <select className="select" value={form.moneda_principal} onChange={(e) => setField('moneda_principal', e.target.value)}>
              <option value="PEN">PEN — Sol</option>
              <option value="USD">USD — Dólar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="CNY">CNY — Yuan</option>
            </select>
          </div>
          <div className="field">
            <label>Condiciones de pago</label>
            <input className="input" placeholder="Ej. 30 días" value={form.condiciones_pago} onChange={(e) => setField('condiciones_pago', e.target.value)} />
          </div>
          <div className="field">
            <label>Estado</label>
            <select className="select" value={form.estado} onChange={(e) => setField('estado', e.target.value)}>
              <option value="ACTIVO">Activo</option>
              <option value="INACTIVO">Inactivo</option>
            </select>
          </div>
        </div>

        <div className="grid-3">
          <div className="field">
            <label>Banco</label>
            <input className="input" value={form.banco} onChange={(e) => setField('banco', e.target.value)} />
          </div>
          <div className="field">
            <label>N° cuenta</label>
            <input className="input" value={form.numero_cuenta} onChange={(e) => setField('numero_cuenta', e.target.value)} />
          </div>
          <div className="field">
            <label>SWIFT</label>
            <input className="input" value={form.swift} onChange={(e) => setField('swift', e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>Observaciones</label>
          <textarea className="textarea" rows={2} value={form.observaciones} onChange={(e) => setField('observaciones', e.target.value)} />
        </div>
      </Modal>

      {/* Detalle proveedor */}
      <Modal
        open={!!view}
        onClose={() => setView(null)}
        title="Detalle del proveedor"
        icon={<Icon name="building" size={18} />}
        size="lg"
        footer={<button className="btn btn-primary" onClick={() => setView(null)}>Entendido</button>}
      >
        {view && (
          <div style={{ fontSize: 13.5 }}>
            {/* Header con info principal */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'flex-start', 
              gap: 16, 
              padding: 18, 
              background: 'linear-gradient(135deg, var(--g-soft), var(--g-softer))',
              border: '1px solid var(--line)',
              borderRadius: 12,
              marginBottom: 20
            }}>
              <div style={{
                width: 54, 
                height: 54, 
                borderRadius: 12, 
                flexShrink: 0,
                background: 'linear-gradient(135deg, var(--g-primary), var(--g-dark))',
                color: '#fff', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(41,167,68,.28)',
                fontSize: 24
              }}>
                <Icon name="building" size={26} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--g-forest)', marginBottom: 6 }}>
                  {view.razon_social}
                </div>
                {view.nombre_comercial && (
                  <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>
                    {view.nombre_comercial}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Badge kind={view.tipo_proveedor === 'NACIONAL' ? 'green' : 'blue'}>{view.tipo_proveedor}</Badge>
                  <Badge kind={view.estado === 'ACTIVO' ? 'green' : 'red'}>{view.estado}</Badge>
                  {view.numero_documento && (
                    <span style={{ 
                      fontSize: 12, 
                      fontWeight: 600, 
                      color: 'var(--muted)',
                      background: '#fff',
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--line)'
                    }}>
                      {view.tipo_documento}: {view.numero_documento}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Información en cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              {/* Contacto */}
              <div style={{ 
                padding: 16, 
                background: '#fff', 
                border: '1px solid var(--line)', 
                borderRadius: 10,
                boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
              }}>
                <div style={{ 
                  fontSize: 11, 
                  fontWeight: 700, 
                  textTransform: 'uppercase', 
                  color: 'var(--g-dark)',
                  letterSpacing: '0.5px',
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}>
                  <Icon name="user-male" size={14} /> Contacto
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--ink)' }}>
                  {view.contacto ? (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <Icon name="user-male-circle" size={15} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 2 }} />
                      <span><strong>{view.contacto}</strong></span>
                    </div>
                  ) : <div className="text-muted">Sin contacto registrado</div>}
                  {view.telefono && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <Icon name="phone" size={15} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 2 }} />
                      <span>{view.telefono}</span>
                    </div>
                  )}
                  {view.email && (
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <Icon name="email" size={15} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 2 }} />
                      <span>{view.email}</span>
                    </div>
                  )}
                  {view.direccion && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                      <Icon name="location" size={15} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <div>{view.direccion}</div>
                        {(view.ciudad || view.departamento || view.pais) && (
                          <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                            {[view.ciudad, view.departamento, view.pais].filter(Boolean).join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Información de pagos */}
              <div style={{ 
                padding: 16, 
                background: '#fff', 
                border: '1px solid var(--line)', 
                borderRadius: 10,
                boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
              }}>
                <div style={{ 
                  fontSize: 11, 
                  fontWeight: 700, 
                  textTransform: 'uppercase', 
                  color: 'var(--g-dark)',
                  letterSpacing: '0.5px',
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}>
                  <Icon name="money" size={14} /> Pagos y Condiciones
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--ink)' }}>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>Moneda principal:</span>
                    <br /><strong>{view.moneda_principal || 'PEN'}</strong>
                  </div>
                  {view.condiciones_pago && (
                    <div style={{ marginBottom: 8 }}>
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>Condiciones:</span>
                      <br /><span>{view.condiciones_pago}</span>
                    </div>
                  )}
                  {view.banco && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                      <div style={{ marginBottom: 4 }}>
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>Banco:</span>
                        <br /><strong>{view.banco}</strong>
                      </div>
                      {view.numero_cuenta && (
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          Cuenta: {view.numero_cuenta}
                        </div>
                      )}
                      {view.swift && (
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          SWIFT: {view.swift}
                        </div>
                      )}
                    </div>
                  )}
                  {!view.banco && !view.condiciones_pago && (
                    <div className="text-muted">Sin información bancaria</div>
                  )}
                </div>
              </div>
            </div>

            {view.observaciones && (
              <div style={{ 
                padding: 14, 
                background: 'var(--y-soft)', 
                border: '1px solid #ffe082', 
                borderRadius: 8,
                marginBottom: 20
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#8a6400', marginBottom: 6 }}>
                  Observaciones
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>{view.observaciones}</div>
              </div>
            )}

            {/* Compras recientes */}
            <div>
              <div style={{ 
                fontSize: 13, 
                fontWeight: 700, 
                color: 'var(--g-forest)',
                marginBottom: 12,
                paddingBottom: 8,
                borderBottom: '2px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}>
                <Icon name="shopping-cart" size={16} /> Compras recientes
              </div>
              {(view.recent_purchases || []).length === 0 ? (
                <div style={{ 
                  padding: 32, 
                  textAlign: 'center', 
                  color: 'var(--muted)', 
                  background: 'var(--bg)',
                  borderRadius: 8
                }}>
                  <Icon name="shopping-cart" size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                  <div>Sin compras registradas</div>
                </div>
              ) : (
                <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 8 }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Tipo</th>
                        <th>Fecha</th>
                        <th>Moneda</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.recent_purchases.map((p) => (
                        <tr key={p.id}>
                          <td><strong style={{ color: 'var(--g-forest)', fontFamily: 'monospace' }}>{p.codigo_compra}</strong></td>
                          <td><Badge kind={p.tipo_compra === 'NACIONAL' ? 'green' : 'blue'}>{p.tipo_compra}</Badge></td>
                          <td className="text-muted" style={{ fontSize: 12 }}>{fmtDate(p.fecha_compra)}</td>
                          <td><Badge kind="gray">{p.moneda}</Badge></td>
                          <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>
                            {Number(p.total || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td><Badge kind="gray">{p.estado}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {ConfirmDialog}
    </>
  );
}