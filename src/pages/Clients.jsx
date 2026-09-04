import { useEffect, useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import { Toolbar, useSearch, useListReload, Loader, EmptyState, ErrorState, fmtDate } from '../components/ui';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../auth';

const emptyDni = { dni: '', names: '', last_names: '', address: '', phone: '' };
const emptyRuc = {
  ruc: '', razonsocial: '', nombrecomercial: '', telefonos: '',
  direccion: '', departamento: '', provincia: '', distrito: '',
  ubigeo: '', estado: '', condicion: '',
  via_tipo: '', via_nombre: '', zona_codigo: '', zona_tipo: '',
  numero: '', interior: '', lote: '', dpto: '', manzana: '', kilometro: '',
  es_agente_retencion: false, es_buen_contribuyente: false, locales_anexos: '',
};

/* ─────────────────────────────────────────────────────────────
   EXCEL PARSING & ROW CLASSIFICATION
   ───────────────────────────────────────────────────────────── */

function normalizeKey(key) {
  const k = key.toLowerCase().trim();
  const map = {
    dni: 'dni', documento: 'dni', doc: 'dni', numero_documento: 'dni', nro_documento: 'dni', 'nro. documento': 'dni',
    nombre: 'names', nombres: 'names', name: 'names', names: 'names', encargado: 'names', representante: 'names', persona: 'names', contacto: 'names',
    'nombre/encargado': 'names', 'nombre encargado': 'names', 'nombre completo': 'names', 'nombre y apellido': 'names',
    'apellido(s)': 'last_names', apellidos: 'last_names', last_names: 'last_names', apellido: 'last_names',
    direccion: 'address', dir: 'address', address: 'address', domicilio: 'address',
    telefono: 'phone', tel: 'phone', phone: 'phone', celular: 'phone', whatsapp: 'phone', movil: 'phone', 'tel/cel': 'phone', 'telefono/celular': 'phone', 'teléfono': 'phone',
    ruc: 'ruc', ruc_numero: 'ruc', 'nro ruc': 'ruc', 'nro. ruc': 'ruc', 'número ruc': 'ruc',
    razon_social: 'razonsocial', razonsocial: 'razonsocial', razon: 'razonsocial', 'razón social': 'razonsocial', 'razon social': 'razonsocial', empresa: 'razonsocial',
    nombre_comercial: 'nombrecomercial', nombrecomercial: 'nombrecomercial', comercial: 'nombrecomercial', 'nombre comercial': 'nombrecomercial',
    telefonos: 'telefonos', tels: 'telefonos', phones: 'telefonos',
    departamento: 'departamento', depto: 'departamento',
    provincia: 'provincia',
    distrito: 'distrito', dist: 'distrito',
  };
  return map[k] || k;
}

function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const rows = raw.map((row) => {
          const mapped = {};
          for (const [key, val] of Object.entries(row)) {
            mapped[normalizeKey(key)] = String(val ?? '').trim();
          }
          return mapped;
        });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function classifyRow(row) {
  const ruc = (row.ruc || '').replace(/\D/g, '');
  if (ruc.length === 11) return 'ruc';
  return 'dni';
}

function buildDniPayload(row) {
  const fullName = (row.names || '').trim();
  const lastNames = (row.last_names || '').trim();
  const names = fullName || lastNames;
  const lastNamesFinal = fullName && lastNames ? lastNames : '';
  const phone = (row.phone || '').trim();
  const missing = [];
  if (!names) missing.push('Nombre(s)');
  if (!phone) missing.push('Telefono');
  return {
    data: {
      dni: (row.dni || '').replace(/\D/g, '').trim(),
      names,
      last_names: lastNamesFinal,
      address: (row.address || '').trim(),
      phone,
    },
    missing,
    valid: missing.length === 0,
  };
}

function buildRucPayload(row) {
  const ruc = (row.ruc || '').replace(/\D/g, '').trim();
  const razonsocial = (row.razonsocial || '').trim();
  const telefonos = (row.telefonos || row.phone || '').trim();
  const missing = [];
  if (!ruc || ruc.length !== 11) missing.push('RUC (11 digitos)');
  if (!razonsocial) missing.push('Razon Social');
  if (!telefonos) missing.push('Telefono(s)');
  return {
    data: {
      ruc,
      razonsocial,
      nombrecomercial: (row.nombrecomercial || '').trim(),
      telefonos,
      direccion: (row.address || row.direccion || '').trim(),
      departamento: (row.departamento || '').trim(),
      provincia: (row.provincia || '').trim(),
      distrito: (row.distrito || '').trim(),
    },
    missing,
    valid: missing.length === 0,
  };
}

/* ─────────────────────────────────────────────────────────────
   UNIFIED IMPORT MODAL
   ───────────────────────────────────────────────────────────── */

function ImportClientsModal({ open, onClose, onImported }) {
  const toast = useToast();
  const { can } = useAuth();
  const [stage, setStage] = useState('upload');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState({ dni: [], ruc: [] });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const reset = () => {
    setStage('upload');
    setFileName('');
    setPreview({ dni: [], ruc: [] });
    setResult(null);
    setProgress(0);
    setBusy(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const processFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      return toast.warning('Selecciona un archivo Excel (.xlsx, .xls) o CSV');
    }
    try {
      let rows;
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        rows = await readExcelFile(file);
      } else {
        const text = await file.text();
        const wb = XLSX.read(text, { type: 'string' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });
        rows = raw.map((row) => {
          const mapped = {};
          for (const [key, val] of Object.entries(row)) {
            mapped[normalizeKey(key)] = String(val ?? '').trim();
          }
          return mapped;
        });
      }
      if (!rows.length) return toast.warning('El archivo no contiene datos');

      const dniRows = [];
      const rucRows = [];
      rows.forEach((row) => {
        const type = classifyRow(row);
        if (type === 'ruc') rucRows.push(buildRucPayload(row));
        else dniRows.push(buildDniPayload(row));
      });

      setFileName(file.name);
      setPreview({ dni: dniRows, ruc: rucRows });
      setStage('preview');
    } catch (e) {
      toast.error('Error al leer el archivo: ' + e.message);
    }
  }, [toast]);

  const handleDrop = (e) => { e.preventDefault(); setDrag(false); processFile(e.dataTransfer.files[0]); };
  const handleDragOver = (e) => { e.preventDefault(); setDrag(true); };
  const handleDragLeave = () => setDrag(false);

  const doImport = async () => {
    const validDni = preview.dni.filter((r) => r.valid).map((r) => r.data);
    const validRuc = preview.ruc.filter((r) => r.valid).map((r) => r.data);
    const totalValid = validDni.length + validRuc.length;
    if (!totalValid) return toast.warning('No hay filas validas para importar');

    setBusy(true);
    setProgress(5);
    const results = { dni: null, ruc: null, errors: [] };

    try {
      if (validDni.length) {
        setProgress(15);
        const { data } = await api.post('/clients/import', validDni);
        results.dni = data;
        results.errors.push(...(data.errors || []).map((e) => ({ ...e, type: 'DNI' })));
        setProgress(validRuc.length ? 50 : 90);
      }
      if (validRuc.length) {
        setProgress(55);
        const { data } = await api.post('/clients-ruc/import', validRuc);
        results.ruc = data;
        results.errors.push(...(data.errors || []).map((e) => ({ ...e, type: 'RUC' })));
        setProgress(90);
      }

      const createdTotal = (results.dni?.created || 0) + (results.ruc?.created || 0);
      const errorTotal = results.errors.length;
      setProgress(100);
      setResult({ createdTotal, errorTotal, errors: results.errors, total: validDni.length + validRuc.length + (preview.dni.length - validDni.length) + (preview.ruc.length - validRuc.length) });
      setStage('result');

      if (createdTotal) toast.success(`${createdTotal} registro(s) importado(s)`);
      if (errorTotal) toast.warning(`${errorTotal} fila(s) con error`);
      if (createdTotal) onImported();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['RUC', 'Razon Social', 'Nombre/Encargado', 'DNI', 'Telefono', 'Direccion', 'Departamento', 'Provincia', 'Distrito'],
      ['20123456789', 'Empresa SAC', 'Juan Perez', '', '987654321', 'Av. Industrial 500', 'Lima', 'Lima', 'Ate'],
      ['', '', 'Maria Lopez Garcia', '12345678', '912345678', 'Calle Los Pinos 200', 'Cusco', 'Cusco', 'Wanchaq'],
      ['20987654321', 'Constructora XYZ', 'Carlos Ruiz Torres', '', '955123456', 'Jr. Comercio 300', 'Arequipa', 'Arequipa', 'Cercado'],
      ['', '', 'Ana Torres Ramos', '', '966789012', 'Av. Los Heroes 456', 'Trujillo', 'Trujillo', 'Flores de Mana'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
    XLSX.writeFile(wb, 'plantilla_clientes.xlsx');
  };

  const totalRows = preview.dni.length + preview.ruc.length;
  const dniValid = preview.dni.filter((r) => r.valid).length;
  const dniError = preview.dni.length - dniValid;
  const rucValid = preview.ruc.filter((r) => r.valid).length;
  const rucError = preview.ruc.length - rucValid;
  const validCount = dniValid + rucValid;
  const errorCount = dniError + rucError;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Importar clientes desde Excel"
      icon={<Icon name="upload" size={18} />}
      size="lg"
      footer={
        stage === 'preview' ? (
          <>
            <button className="btn btn-ghost" onClick={reset} disabled={busy}><Icon name="x" size={15} /> Volver</button>
            <button className="btn btn-primary" onClick={doImport} disabled={busy || !validCount}>
              {busy ? <span className="spinner" /> : <Icon name="upload" size={15} />} Importar {validCount} registro(s)
            </button>
          </>
        ) : stage === 'result' ? (
          <button className="btn btn-primary" onClick={handleClose}><Icon name="checkmark" size={15} /> Cerrar</button>
        ) : null
      }
    >
      {stage === 'upload' && (
        <>
          <div className="import-hint">
            <b>Formato Excel (.xlsx):</b> El sistema clasifica automaticamente cada fila:
            <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: 12.5 }}>
              <li><b>Con RUC (11 digitos)</b> → se importa como Empresa</li>
              <li><b>Sin RUC</b> → se importa como Persona (DNI)</li>
            </ul>
            <br />
            <b>Personas (DNI):</b> obligatorio Nombre/Encargado y Telefono. Opcionales: DNI, Direccion.<br />
            <b>Empresas (RUC):</b> obligatorio RUC, Razon Social y Telefono(s).
          </div>
          <div
            className={`import-dropzone ${drag ? 'drag' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => inputRef.current?.click()}
          >
            <Icon name="upload" size={36} />
            <b>Arrastra tu archivo Excel aqui</b>
            <p>o haz clic para seleccionar (.xlsx, .xls, .csv)</p>
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => processFile(e.target.files[0])} />
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); downloadTemplate(); }}>
              <Icon name="download" size={14} /> Descargar plantilla
            </button>
          </div>
        </>
      )}

      {stage === 'preview' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 13 }}>
            <span><b>{fileName}</b> — {totalRows} fila(s) detectada(s)</span>
            <span style={{ display: 'flex', gap: 14 }}>
              <span className="cell-ok" style={{ fontWeight: 600 }}>{validCount} valida(s)</span>
              {errorCount > 0 && <span className="cell-err">{errorCount} con error</span>}
            </span>
          </div>

          {preview.dni.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--g-dark)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="user-male-circle" size={14} /> Personas (DNI) — {preview.dni.length} fila(s)
              </div>
              <div className="import-preview-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>DNI</th>
                      <th>Nombre completo</th>
                      <th>Telefono</th>
                      <th>Direccion</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.dni.map((row, i) => (
                      <tr key={i} className={row.valid ? '' : 'import-row-error'}>
                        <td className="row-num">{i + 1}</td>
                        <td>{row.data.dni || '—'}</td>
                        <td className={row.data.names ? 'cell-ok' : 'cell-err'}>{row.data.names || 'FALTA'}</td>
                        <td className={row.data.phone ? 'cell-ok' : 'cell-err'}>{row.data.phone || 'FALTA'}</td>
                        <td>{row.data.address || '—'}</td>
                        <td>{row.valid
                          ? <Icon name="checkmark--v1" size={15} className="cell-ok" />
                          : <span className="cell-err" style={{ fontSize: 11 }}>{row.missing.join(', ')}</span>
                        }</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.ruc.length > 0 && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--g-dark)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="building" size={14} /> Empresas (RUC) — {preview.ruc.length} fila(s)
              </div>
              <div className="import-preview-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>RUC</th>
                      <th>Razon Social</th>
                      <th>Nombre Com.</th>
                      <th>Telefonos</th>
                      <th>Direccion</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.ruc.map((row, i) => (
                      <tr key={i} className={row.valid ? '' : 'import-row-error'}>
                        <td className="row-num">{i + 1}</td>
                        <td className={row.data.ruc?.length === 11 ? 'cell-ok' : 'cell-err'}>{row.data.ruc || 'FALTA'}</td>
                        <td className={row.data.razonsocial ? 'cell-ok' : 'cell-err'}>{row.data.razonsocial || 'FALTA'}</td>
                        <td>{row.data.nombrecomercial || '—'}</td>
                        <td className={row.data.telefonos ? 'cell-ok' : 'cell-err'}>{row.data.telefonos || 'FALTA'}</td>
                        <td>{row.data.direccion || '—'}</td>
                        <td>{row.valid
                          ? <Icon name="checkmark--v1" size={15} className="cell-ok" />
                          : <span className="cell-err" style={{ fontSize: 11 }}>{row.missing.join(', ')}</span>
                        }</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {busy && (
            <div className="import-progress">
              <div className="import-progress-bar" style={{ width: `${progress}%` }} />
            </div>
          )}
        </>
      )}

      {stage === 'result' && result && (
        <>
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <Icon name="checkmark--v1" size={44} className="cell-ok" />
            <h3 style={{ margin: '10px 0 4px', color: 'var(--ink)' }}>Importacion completada</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Se procesaron {result.total} fila(s)</p>
          </div>
          <div className="import-summary" style={{ justifyContent: 'center' }}>
            <span className="stat ok"><Icon name="checkmark--v1" size={16} /> {result.createdTotal} creado(s)</span>
            {result.errorTotal > 0 && <span className="stat err"><Icon name="cancel" size={16} /> {result.errorTotal} error(es)</span>}
          </div>
          {result.errors?.length > 0 && (
            <div className="import-preview-wrap" style={{ marginTop: 14, maxHeight: 160 }}>
              <table>
                <thead><tr><th>Fila</th><th>Tipo</th><th>Error</th></tr></thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i} className="import-row-error">
                      <td className="row-num">{e.row}</td>
                      <td><span className="chip" style={{ fontSize: 10 }}>{e.type}</span></td>
                      <td className="cell-err">{e.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DNI TAB
   ═══════════════════════════════════════════════════════════════ */

function DniTab({ reloadKey }) {
  const toast = useToast();
  const { can } = useAuth();
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
  const [filters, setFilters] = useState({ phone: '', departamento: '' });
  const [detailRow, setDetailRow] = useState(null);

  const load = () => {
    setFailed(false);
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      ...(showDeleted && { include_deleted: 'true' }),
      ...(filters.phone && { phone: filters.phone }),
      ...(filters.departamento && { departamento: filters.departamento }),
    });
    api.get(`/clients?${params}`).then((r) => setData(r.data)).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [showDeleted, page]);
  useEffect(() => { if (reloadKey > 0) load(); }, [reloadKey]);
  useEffect(() => { setPage(1); load(); }, [filters]);

  const rows = data?.items || [];
  const pagination = data?.pagination;

  const { q, setQ, filtered } = useSearch(rows, [(r) => r.names, (r) => r.last_names, (r) => r.dni, (r) => r.phone]);
  const reloadList = useListReload(page, setPage, load, editingId);

  const openAdd = () => { setEditingId(null); setForm(emptyDni); setSource(''); setModal(true); };
  const openEdit = (r) => { setEditingId(r.id); setForm({ dni: r.dni, names: r.names, last_names: r.last_names || '', address: r.address || '', phone: r.phone || '' }); setSource(''); setModal(true); };

  const consultarDni = async () => {
    const dni = form.dni.replace(/\D/g, '');
    if (!/^\d{8}$/.test(dni)) return toast.warning('Ingresa un DNI de 8 digitos para consultar en RENIEC');
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
    if (!form.dni || !/^\d{8}$/.test(form.dni)) return toast.warning('El DNI debe tener 8 digitos');
    if (!form.names.trim()) return toast.warning('El nombre es obligatorio');
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
    const ok = await ask({ title: 'Eliminar cliente', message: `¿Deseas eliminar a ${r.names}?`, confirmText: 'Eliminar' });
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

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '10px 16px', fontSize: 13 }}>
          <span style={{ fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="filter" size={14} /> Filtros:</span>
          <input className="input" style={{ width: 160 }} placeholder="Telefono" value={filters.phone} onChange={(e) => setFilters({ ...filters, phone: e.target.value })} />
          <input className="input" style={{ width: 160 }} placeholder="Direccion / Depto" value={filters.departamento} onChange={(e) => setFilters({ ...filters, departamento: e.target.value })} />
          {Object.values(filters).some(Boolean) && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ phone: '', departamento: '' })}><Icon name="x" size={13} /> Limpiar</button>
          )}
        </div>
      </div>

      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar por DNI, nombre o telefono...">
          <span className="pill-count">{pagination?.total || 0} clientes</span>
          {can('CLIENTS_CREATE') && <button className="btn btn-primary" onClick={openAdd}><Icon name="plus" size={16} /> Agregar Cliente</button>}
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>DNI</th><th>Nombre completo</th><th>Telefono</th><th>Direccion</th><th>Registro</th><th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={r.deleted ? { opacity: 0.55 } : {}}>
                  <td data-label="DNI"><span className="chip">{r.dni || '—'}</span></td>
                  <td data-label="Nombre completo"><span className="cell-title">{r.names} {r.last_names}</span></td>
                  <td data-label="Telefono" style={{ color: 'var(--ink)' }}>{r.phone || '—'}</td>
                  <td data-label="Direccion" className="desc-cell">{r.address || '—'}</td>
                  <td data-label="Registro" className="text-muted">{fmtDate(r.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-icon" onClick={() => setDetailRow(r)} title="Ver detalle"><Icon name="eye" size={14} /></button>
                      {r.deleted ? (
                        <button className="btn-icon" onClick={() => restore(r)} title="Restaurar"><Icon name="undo" size={14} /></button>
                      ) : (
                        <>
                          {can('CLIENTS_UPDATE') && <button className="btn-icon" onClick={() => openEdit(r)} title="Editar"><Icon name="edit" size={14} /></button>}
                          {can('CLIENTS_DELETE') && <button className="btn-icon danger" onClick={() => remove(r)} title="Eliminar"><Icon name="trash" size={14} /></button>}
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
            <input className="input" maxLength={8} placeholder="8 digitos" value={form.dni} onChange={(e) => setForm({ ...form, dni: e.target.value.replace(/\D/g, '') })} />
            <button type="button" className="btn btn-yellow" style={{ minWidth: 120, flexShrink: 0 }} onClick={consultarDni} disabled={consulting}>
              {consulting ? <span className="spinner" /> : <Icon name="checked-user-male" size={15} />} Consultar
            </button>
          </div>
          {source && <div className="hint" style={{ marginTop: 4 }}>Datos obtenidos de {source}</div>}
        </div>
        <div className="grid-2">
          <div className="field"><label>Nombre(s) <span className="req">*</span></label><input className="input" value={form.names} onChange={(e) => setForm({ ...form, names: e.target.value })} /></div>
          <div className="field"><label>Apellido(s)</label><input className="input" value={form.last_names} onChange={(e) => setForm({ ...form, last_names: e.target.value })} /></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>Direccion</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="field"><label>Telefono / WhatsApp</label><input className="input" maxLength={9} placeholder="Ej. 987654321" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })} /></div>
        </div>
        <div className="hint">El telefono permite enviar los documentos (boleta, factura, proforma) al cliente por WhatsApp.</div>
      </Modal>

      <Modal open={!!detailRow} onClose={() => setDetailRow(null)} title="Detalle del cliente" icon={<Icon name="eye" size={18} />}>
        {detailRow && (
          <div style={{ fontSize: 13 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
              <div><span style={{ color: 'var(--muted)' }}>DNI:</span> <b>{detailRow.dni || '—'}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Nombre:</span> <b>{detailRow.names}</b></div>
              {detailRow.last_names && <div><span style={{ color: 'var(--muted)' }}>Apellidos:</span> <b>{detailRow.last_names}</b></div>}
              <div><span style={{ color: 'var(--muted)' }}>Telefono:</span> <b>{detailRow.phone || '—'}</b></div>
              <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--muted)' }}>Direccion:</span> <b>{detailRow.address || '—'}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Registro:</span> <b>{fmtDate(detailRow.created_at)}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Estado:</span> <span className={`chip ${detailRow.deleted ? 'deleted' : ''}`} style={{ marginLeft: 4 }}>{detailRow.deleted ? 'Inactivo' : 'Activo'}</span></div>
            </div>
          </div>
        )}
      </Modal>
      {ConfirmDialog}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   RUC TAB
   ═══════════════════════════════════════════════════════════════ */

function RucTab({ reloadKey }) {
  const toast = useToast();
  const { can } = useAuth();
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
  const [filters, setFilters] = useState({ departamento: '', provincia: '', distrito: '' });
  const [detailRow, setDetailRow] = useState(null);

  const load = () => {
    setFailed(false);
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      ...(showDeleted && { include_deleted: 'true' }),
      ...(filters.departamento && { departamento: filters.departamento }),
      ...(filters.provincia && { provincia: filters.provincia }),
      ...(filters.distrito && { distrito: filters.distrito }),
    });
    api.get(`/clients-ruc?${params}`).then((r) => setData(r.data)).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [showDeleted, page]);
  useEffect(() => { if (reloadKey > 0) load(); }, [reloadKey]);
  useEffect(() => { setPage(1); load(); }, [filters]);

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
    if (!/^\d{11}$/.test(ruc)) return toast.warning('Ingresa un RUC de 11 digitos para consultar en SUNAT');
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
    if (!form.ruc || !/^\d{11}$/.test(form.ruc)) return toast.warning('El RUC debe tener 11 digitos');
    if (!form.razonsocial.trim()) return toast.warning('La razon social es obligatoria');
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

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '10px 16px', fontSize: 13 }}>
          <span style={{ fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 5 }}><Icon name="filter" size={14} /> Filtros:</span>
          <input className="input" style={{ width: 150 }} placeholder="Departamento" value={filters.departamento} onChange={(e) => setFilters({ ...filters, departamento: e.target.value })} />
          <input className="input" style={{ width: 150 }} placeholder="Provincia" value={filters.provincia} onChange={(e) => setFilters({ ...filters, provincia: e.target.value })} />
          <input className="input" style={{ width: 150 }} placeholder="Distrito" value={filters.distrito} onChange={(e) => setFilters({ ...filters, distrito: e.target.value })} />
          {Object.values(filters).some(Boolean) && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ departamento: '', provincia: '', distrito: '' })}><Icon name="x" size={13} /> Limpiar</button>
          )}
        </div>
      </div>

      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar por RUC o razon social...">
          <span className="pill-count">{pagination?.total || 0} empresas</span>
          {can('CLIENTS_CREATE') && <button className="btn btn-primary" onClick={openAdd}><Icon name="plus" size={16} /> Agregar Empresa</button>}
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>RUC</th><th>Razon social</th><th>Nombre comercial</th><th>Telefonos</th><th>Ubicacion</th><th>Estado</th><th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={r.deleted ? { opacity: 0.55 } : {}}>
                  <td data-label="RUC"><span className="chip">{r.ruc}</span></td>
                  <td data-label="Razon social"><span className="cell-title">{r.razonsocial}</span></td>
                  <td data-label="Nombre comercial" className="text-muted">{r.nombrecomercial || '—'}</td>
                  <td data-label="Telefonos">
                    <span className="flex" style={{ color: '#1eaa47', fontSize: 12.5 }}>
                      <Icon name="phone" size={12} /> {(Array.isArray(r.telefonos) ? r.telefonos.join(', ') : r.telefonos) || '—'}
                    </span>
                  </td>
                  <td data-label="Ubicacion" className="text-muted" style={{ fontSize: 12.5 }}>{[r.departamento, r.provincia, r.distrito].filter(Boolean).join(' · ') || '—'}</td>
                  <td data-label="Estado"><span className="chip">{r.estado || '—'}</span></td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-icon" onClick={() => setDetailRow(r)} title="Ver detalle"><Icon name="eye" size={14} /></button>
                      {r.deleted ? (
                        <button className="btn-icon" onClick={() => restore(r)} title="Restaurar"><Icon name="undo" size={14} /></button>
                      ) : (
                        <>
                          {can('CLIENTS_UPDATE') && <button className="btn-icon" onClick={() => openEdit(r)} title="Editar"><Icon name="edit" size={14} /></button>}
                          {can('CLIENTS_DELETE') && <button className="btn-icon danger" onClick={() => remove(r)} title="Eliminar"><Icon name="trash" size={14} /></button>}
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
            <input className="input" maxLength={11} placeholder="11 digitos" value={form.ruc} onChange={(e) => setForm({ ...form, ruc: e.target.value.replace(/\D/g, '') })} />
            <button type="button" className="btn btn-yellow" style={{ minWidth: 120, flexShrink: 0 }} onClick={consultarRuc} disabled={consulting}>
              {consulting ? <span className="spinner" /> : <Icon name="checked-user-male" size={15} />} Consultar
            </button>
          </div>
          {source && <div className="hint" style={{ marginTop: 4 }}>Datos obtenidos de {source}</div>}
        </div>
        <div className="grid-2">
          <div className="field"><label>Razon social <span className="req">*</span></label><input className="input" value={form.razonsocial} onChange={(e) => setForm({ ...form, razonsocial: e.target.value })} /></div>
          <div className="field"><label>Nombre comercial</label><input className="input" value={form.nombrecomercial} onChange={(e) => setForm({ ...form, nombrecomercial: e.target.value })} /></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>Telefonos (separados por coma)</label><input className="input" placeholder="964123456, 064123456" value={form.telefonos} onChange={(e) => setForm({ ...form, telefonos: e.target.value })} /></div>
          <div className="field"><label>Direccion</label><input className="input" value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} /></div>
        </div>
        <div className="grid-3">
          <div className="field"><label>Departamento</label><input className="input" value={form.departamento} onChange={(e) => setForm({ ...form, departamento: e.target.value })} /></div>
          <div className="field"><label>Provincia</label><input className="input" value={form.provincia} onChange={(e) => setForm({ ...form, provincia: e.target.value })} /></div>
          <div className="field"><label>Distrito</label><input className="input" value={form.distrito} onChange={(e) => setForm({ ...form, distrito: e.target.value })} /></div>
        </div>
        <div className="grid-3">
          <div className="field"><label>Ubigeo</label><input className="input" value={form.ubigeo} onChange={(e) => setForm({ ...form, ubigeo: e.target.value })} /></div>
          <div className="field"><label>Estado</label><input className="input" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} /></div>
          <div className="field"><label>Condicion</label><input className="input" value={form.condicion} onChange={(e) => setForm({ ...form, condicion: e.target.value })} /></div>
        </div>
        <div className="grid-3">
          <div className="field"><label>Tipo de via</label><input className="input" value={form.via_tipo} onChange={(e) => setForm({ ...form, via_tipo: e.target.value })} /></div>
          <div className="field"><label>Nombre de via</label><input className="input" value={form.via_nombre} onChange={(e) => setForm({ ...form, via_nombre: e.target.value })} /></div>
          <div className="field"><label>Numero</label><input className="input" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></div>
        </div>
        <div className="grid-4">
          <div className="field"><label>Interior</label><input className="input" value={form.interior} onChange={(e) => setForm({ ...form, interior: e.target.value })} /></div>
          <div className="field"><label>Lote</label><input className="input" value={form.lote} onChange={(e) => setForm({ ...form, lote: e.target.value })} /></div>
          <div className="field"><label>Dpto</label><input className="input" value={form.dpto} onChange={(e) => setForm({ ...form, dpto: e.target.value })} /></div>
          <div className="field"><label>Manzana</label><input className="input" value={form.manzana} onChange={(e) => setForm({ ...form, manzana: e.target.value })} /></div>
        </div>
        <div className="grid-4">
          <div className="field"><label>Kilometro</label><input className="input" value={form.kilometro} onChange={(e) => setForm({ ...form, kilometro: e.target.value })} /></div>
          <div className="field"><label>Codigo de zona</label><input className="input" value={form.zona_codigo} onChange={(e) => setForm({ ...form, zona_codigo: e.target.value })} /></div>
          <div className="field"><label>Tipo de zona</label><input className="input" value={form.zona_tipo} onChange={(e) => setForm({ ...form, zona_tipo: e.target.value })} /></div>
          <div className="field"><label>Locales anexos</label><input className="input" placeholder="JSON o texto" value={form.locales_anexos} onChange={(e) => setForm({ ...form, locales_anexos: e.target.value })} /></div>
        </div>
        <div className="grid-2" style={{ marginTop: 8 }}>
          <label className="check"><input type="checkbox" checked={form.es_agente_retencion} onChange={(e) => setForm({ ...form, es_agente_retencion: e.target.checked })} /> Agente de retencion</label>
          <label className="check"><input type="checkbox" checked={form.es_buen_contribuyente} onChange={(e) => setForm({ ...form, es_buen_contribuyente: e.target.checked })} /> Buen contribuyente</label>
        </div>
      </Modal>

      <Modal open={!!detailRow} onClose={() => setDetailRow(null)} title="Detalle de la empresa" icon={<Icon name="building" size={18} />} size="lg">
        {detailRow && (
          <div style={{ fontSize: 13 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 20px' }}>
              <div><span style={{ color: 'var(--muted)' }}>RUC:</span> <b>{detailRow.ruc}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Razon social:</span> <b>{detailRow.razonsocial}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Nombre comercial:</span> <b>{detailRow.nombrecomercial || '—'}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Telefonos:</span> <b>{(Array.isArray(detailRow.telefonos) ? detailRow.telefonos.join(', ') : detailRow.telefonos) || '—'}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Estado:</span> <b>{detailRow.estado || '—'}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Condicion:</span> <b>{detailRow.condicion || '—'}</b></div>
              <div style={{ gridColumn: '1 / -1' }}><span style={{ color: 'var(--muted)' }}>Direccion:</span> <b>{detailRow.direccion || '—'}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Departamento:</span> <b>{detailRow.departamento || '—'}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Provincia:</span> <b>{detailRow.provincia || '—'}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Distrito:</span> <b>{detailRow.distrito || '—'}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Ubigeo:</span> <b>{detailRow.ubigeo || '—'}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Registro:</span> <b>{fmtDate(detailRow.created_at)}</b></div>
              <div><span style={{ color: 'var(--muted)' }}>Agente retencion:</span> <b>{detailRow.es_agente_retencion ? 'Si' : 'No'}</b></div>
            </div>
          </div>
        )}
      </Modal>
      {ConfirmDialog}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */

export default function Clients() {
  const { can } = useAuth();
  const [tab, setTab] = useState('dni');
  const [importOpen, setImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const handleImported = () => setReloadKey((k) => k + 1);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Clientes</h1>
          <div className="sub">Personas naturales (DNI) y empresas (RUC)</div>
        </div>
        {can('CLIENTS_CREATE') && (
          <button className="btn btn-outline" onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={15} /> Importar desde Excel
          </button>
        )}
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'dni' ? 'active' : ''}`} onClick={() => setTab('dni')}><Icon name="user-male-circle" size={15} /> Personas (DNI)</button>
        <button className={`tab ${tab === 'ruc' ? 'active' : ''}`} onClick={() => setTab('ruc')}><Icon name="building" size={15} /> Empresas (RUC)</button>
      </div>
      {tab === 'dni' ? <DniTab reloadKey={reloadKey} /> : <RucTab reloadKey={reloadKey} />}
      <ImportClientsModal open={importOpen} onClose={() => setImportOpen(false)} onImported={handleImported} />
    </>
  );
}
