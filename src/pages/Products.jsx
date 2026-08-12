import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Tractor, Save, X, ListPlus, Ruler, CheckCircle2, FileText } from 'lucide-react';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import { Toolbar, useSearch, Loader, EmptyState, ErrorState, ImageCell, PdfLink, fmtMoney, fmtDate } from '../components/ui';
import { FileUpload } from '../components/FileUpload';
import { Pagination } from '../components/Pagination';

const empty = {
  name: '', description: '', price: '', image_url: null, pdf_url: null,
  specifications: [], features: [], dimensions: { width: '', height: '', depth: '', weight: '' },
};

const parseJson = (v, fallback) => {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v ?? fallback;
  try { const p = JSON.parse(v); return p ?? fallback; } catch { return fallback; }
};

export default function Products() {
  const toast = useToast();
  const { ask, ConfirmDialog } = useConfirm();
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);

  const load = () => {
    setFailed(false);
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString()
    });
    api.get(`/products?${params}`).then((r) => setData(r.data)).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [page]);

  const rows = data?.items || [];
  const pagination = data?.pagination;

  const { q, setQ, filtered } = useSearch(rows, [(r) => r.name, (r) => r.description]);

  const openAdd = () => { setEditingId(null); setForm(empty); setModal(true); };
  const openEdit = (r) => {
    setEditingId(r.id);
    setForm({
      name: r.name || '',
      description: r.description || '',
      price: r.price || '',
      image_url: r.image_url,
      pdf_url: r.pdf_url,
      specifications: parseJson(r.specifications, []),
      features: parseJson(r.features, []),
      dimensions: parseJson(r.dimensions, { width: '', height: '', depth: '', weight: '' }),
    });
    setModal(true);
  };

  const setSpec = (i, k, v) => setForm((f) => ({ ...f, specifications: f.specifications.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));
  const addSpec = () => setForm((f) => ({ ...f, specifications: [...f.specifications, { label: '', value: '' }] }));
  const setFeature = (i, v) => setForm((f) => ({ ...f, features: f.features.map((x, j) => (j === i ? v : x)) }));
  const addFeature = () => setForm((f) => ({ ...f, features: [...f.features, ''] }));

  const save = async () => {
    if (!form.name.trim()) return toast.warning('El nombre del producto es obligatorio');
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        price: form.price === '' ? 0 : parseFloat(String(form.price).replace(',', '.')),
        image_url: form.image_url,
        pdf_url: form.pdf_url,
        specifications: JSON.stringify(form.specifications.filter((s) => s.label || s.value)),
        features: JSON.stringify(form.features.filter((f) => f.trim())),
        dimensions: JSON.stringify({
          width: form.dimensions.width === '' ? 0 : parseFloat(form.dimensions.width),
          height: form.dimensions.height === '' ? 0 : parseFloat(form.dimensions.height),
          depth: form.dimensions.depth === '' ? 0 : parseFloat(form.dimensions.depth),
          weight: form.dimensions.weight === '' ? 0 : parseFloat(form.dimensions.weight),
        }),
      };
      if (editingId) {
        await api.put(`/products/${editingId}`, payload);
        toast.success('Producto actualizado');
      } else {
        await api.post('/products', payload);
        toast.success('Producto creado');
      }
      setModal(false);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const remove = async (r) => {
    const ok = await ask({ title: 'Eliminar producto', message: `¿Deseas eliminar "${r.name}"?`, confirmText: 'Eliminar' });
    if (!ok) return;
    try {
      await api.delete(`/products/${r.id}`);
      toast.success('Producto eliminado');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!data) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar los productos" /> : <Loader text="Cargando productos..." />;

  const specs = form.specifications;
  const dim = form.dimensions;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Productos</h1>
          <div className="sub">Maquinarias y productos fabricados · Galería</div>
        </div>
        <button className="btn btn-primary btn-lg" onClick={openAdd}><Plus size={17} /> Agregar Producto</button>
      </div>

      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar producto...">
          <span className="pill-count">{filtered.length} productos</span>
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Imagen</th>
                <th>Producto</th>
                <th>Precio</th>
                <th>Dimensiones</th>
                <th>Ficha PDF</th>
                <th>Registro</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const d = parseJson(r.dimensions, {});
                return (
                  <tr key={r.id}>
                    <td><ImageCell src={r.image_url} /></td>
                    <td>
                      <div className="cell-title">{r.name}</div>
                      <div className="desc-cell">{r.description || ''}</div>
                    </td>
                    <td className="money"><b>{fmtMoney(r.price)}</b></td>
                    <td className="text-muted" style={{ fontSize: 12.5 }}>
                      {d.width ? `${d.width}×${d.height}×${d.depth} cm` : '—'}
                      {d.weight ? <div>Peso: {d.weight} kg</div> : null}
                    </td>
                    <td><PdfLink url={r.pdf_url} /></td>
                    <td className="text-muted">{fmtDate(r.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn-icon" onClick={() => openEdit(r)} title="Editar"><Pencil size={14} /></button>
                        <button className="btn-icon danger" onClick={() => remove(r)} title="Eliminar"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title={q ? 'Sin coincidencias' : 'No hay productos'} hint={q ? 'Prueba con otro término' : 'Agrega tu primer producto'} />}
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
        title={editingId ? 'Editar producto' : 'Nuevo producto'}
        icon={<Tractor size={18} />}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><X size={15} /> Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? <span className="spinner" /> : <Save size={15} />} Guardar producto
            </button>
          </>
        }
      >
        <div className="field">
          <label>Nombre del producto <span className="req">*</span></label>
          <input className="input" maxLength={100} placeholder="Ej. Cultivadora 3000" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label>Descripción</label>
          <textarea className="textarea" placeholder="Descripción breve del producto" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Precio (S/)</label>
            <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label><ListPlus size={14} /> Especificaciones técnicas</label>
          {specs.map((s, i) => (
            <div className="grid-2" style={{ marginBottom: 8 }} key={i}>
              <input className="input" placeholder="Ej. Potencia" maxLength={50} value={s.label} onChange={(e) => setSpec(i, 'label', e.target.value)} />
              <div className="flex">
                <input className="input" placeholder="Ej. 100 HP" maxLength={100} value={s.value} onChange={(e) => setSpec(i, 'value', e.target.value)} />
                <button className="btn-icon danger" onClick={() => setForm((f) => ({ ...f, specifications: f.specifications.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={addSpec}><ListPlus size={14} /> Añadir especificación</button>
        </div>

        <div className="field">
          <label><CheckCircle2 size={14} /> Características destacadas</label>
          {form.features.map((f, i) => (
            <div className="flex" style={{ marginBottom: 8 }} key={i}>
              <input className="input" placeholder="Ej. Alta durabilidad" maxLength={200} value={f} onChange={(e) => setFeature(i, e.target.value)} />
              <button className="btn-icon danger" onClick={() => setForm((s) => ({ ...s, features: s.features.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={addFeature}><Plus size={14} /> Añadir característica</button>
        </div>

        <div className="field">
          <label><Ruler size={14} /> Dimensiones y peso</label>
          <div className="grid-3">
            <div><input className="input" type="number" min="0" step="0.1" placeholder="Ancho (cm)" value={dim.width} onChange={(e) => setForm((f) => ({ ...f, dimensions: { ...f.dimensions, width: e.target.value } }))} /></div>
            <div><input className="input" type="number" min="0" step="0.1" placeholder="Alto (cm)" value={dim.height} onChange={(e) => setForm((f) => ({ ...f, dimensions: { ...f.dimensions, height: e.target.value } }))} /></div>
            <div><input className="input" type="number" min="0" step="0.1" placeholder="Profundidad (cm)" value={dim.depth} onChange={(e) => setForm((f) => ({ ...f, dimensions: { ...f.dimensions, depth: e.target.value } }))} /></div>
            <div><input className="input" type="number" min="0" step="0.1" placeholder="Peso (kg)" value={dim.weight} onChange={(e) => setForm((f) => ({ ...f, dimensions: { ...f.dimensions, weight: e.target.value } }))} /></div>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label><FileText size={14} /> Ficha técnica (PDF)</label>
            <FileUpload value={form.pdf_url} onChange={(u) => setForm({ ...form, pdf_url: u })} isImage={false} accept="application/pdf" label="Arrastra un PDF o haz clic para seleccionarlo (máx. 10MB)" />
          </div>
          <div className="field">
            <label>Imagen del producto</label>
            <FileUpload value={form.image_url} onChange={(u) => setForm({ ...form, image_url: u })} />
          </div>
        </div>
      </Modal>

      {ConfirmDialog}
    </>
  );
}