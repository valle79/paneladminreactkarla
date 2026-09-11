import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import {
  Toolbar, useSearch, useListReload, Loader, EmptyState, ErrorState, fmtDate, fmtDateTime, Badge,
} from '../components/ui';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../auth';
import { PaymentModal } from '../components/PaymentModal';

const CURR_SYM = { PEN: 'S/', USD: 'US$', EUR: '€', CNY: 'CN¥' };
const CURRENCIES = ['PEN', 'USD', 'EUR', 'CNY'];

const fmtAmount = (v, cur = 'PEN') =>
  `${CURR_SYM[cur] || cur} ${Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ESTADO_COMPRA_MAP = {
  BORRADOR: ['gray', 'Borrador'],
  ORDENADA: ['blue', 'Ordenada'],
  CONFIRMADA: ['yellow', 'Confirmada'],
  EN_TRANSITO: ['blue', 'En tránsito'],
  RECIBIDA_PARCIAL: ['yellow', 'Recibida parcial'],
  RECIBIDA_COMPLETA: ['green', 'Recibida completa'],
  CANCELADA: ['red', 'Cancelada'],
};

const ESTADO_PAGO_MAP = {
  PENDIENTE: ['red', 'Pendiente'],
  PAGADA_PARCIAL: ['yellow', 'Pagada parcial'],
  PAGADA: ['green', 'Pagada'],
  VENCIDA: ['red', 'Vencida'],
  ANULADA: ['gray', 'Anulada'],
};

const DESTINO_MAP = {
  PARA_CLIENTE: ['blue', 'Para cliente'],
  STOCK: ['green', 'Stock'],
  MANTENIMIENTO: ['yellow', 'Mantenimiento'],
  PRODUCCION_INTERNA: ['blue', 'Producción interna'],
  USO_INTERNO: ['gray', 'Uso interno'],
  OTRO: ['gray', 'Otro'],
};

const TIPO_COMPROBANTE_OPTS = ['FACTURA', 'BOLETA', 'RECIBO', 'NOTA_DE_VENTA', 'OTRO'];

const DEFAULT_UNITS = [
  { code: 'UND', name: 'Unidad' }, { code: 'KG', name: 'Kilogramo' }, { code: 'GR', name: 'Gramo' },
  { code: 'MT', name: 'Metro' }, { code: 'LT', name: 'Litro' }, { code: 'GAL', name: 'Galón' },
  { code: 'PAR', name: 'Par' }, { code: 'JGO', name: 'Juego' }, { code: 'CJ', name: 'Caja' },
  { code: 'PZA', name: 'Pieza' }, { code: 'SERV', name: 'Servicio' },
];

const SEARCH_KEYS = [
  (r) => r.codigo_compra,
  (r) => r.supplier?.razon_social,
  (r) => r.supplier?.numero_documento,
  (r) => r.tipo_comprobante,
  (r) => `${r.serie_comprobante || ''}${r.numero_comprobante || ''}`,
  (r) => (r.destinos || []).join(' '),
  (r) => (r.clientes || []).join(' '),
];

export default function Purchases({ tipo = 'NACIONAL' }) {
  const toast = useToast();
  const { can } = useAuth();
  const { ask, ConfirmDialog } = useConfirm();
  const isIntl = tipo === 'INTERNACIONAL';

  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [pagination, setPagination] = useState(null);
  const [estado, setEstado] = useState('');
  const [estadoPago, setEstadoPago] = useState('');
  const [moneda, setMoneda] = useState('');
  const [destino, setDestino] = useState('');

  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [suppliers, setSuppliers] = useState(null);
  const [products, setProducts] = useState(null);
  const [spares, setSpares] = useState(null);
  const [piezas, setPiezas] = useState(null);
  const [services, setServices] = useState(null);
  const [clients, setClients] = useState(null);
  const [rucs, setRucs] = useState(null);
  const [units, setUnits] = useState(null);

  const [view, setView] = useState(null);
  const [viewBusy, setViewBusy] = useState(false);

  const [catsLoading, setCatsLoading] = useState(false);
  const [catsError, setCatsError] = useState(false);

  const [piezaModal, setPiezaModal] = useState(false);
  const [piezaForm, setPiezaForm] = useState({ name: '', codigo: '', precio: '', unidad: 'UND' });
  const [piezaBusy, setPiezaBusy] = useState(false);

  const load = () => {
    setFailed(false);
    const params = new URLSearchParams({ page: page.toString(), limit: limit.toString(), tipo });
    if (estado) params.set('estado', estado);
    if (estadoPago) params.set('estado_pago', estadoPago);
    if (moneda) params.set('moneda', moneda);
    if (destino) params.set('destino', destino);
    api.get(`/purchases?${params}`)
      .then((r) => { setRows(r.data.items); setPagination(r.data.pagination); })
      .catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [page, estado, estadoPago, moneda, destino]);

  useEffect(() => { loadCatalogs(); }, []);

  const reloadList = useListReload(page, setPage, load, editingId);

  const fetchAll = async (res) => {
    const first = res.data;
    const items = [...(first.items || [])];
    const pages = first.pagination?.total_pages || 1;
    if (pages > 1) {
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          api.get(res.config.url, { params: { ...res.config.params, page: i + 2 } })
        )
      );
      rest.forEach((x) => items.push(...(x.data.items || [])));
    }
    return items;
  };

  const loadCatalogs = async () => {
    if (suppliers && products && spares && piezas && services && units && clients && rucs) return;
    setCatsLoading(true);
    setCatsError(false);
    try {
      const r = await api.get('/catalogo-compras');
      setSuppliers(r.data.suppliers || []);
      setProducts(r.data.products || []);
      setSpares(r.data.spare_parts || []);
      setPiezas(r.data.piezas || []);
      setServices(r.data.services || []);
      setClients(r.data.clients || []);
      setRucs(r.data.clients_ruc || []);
      setUnits(r.data.units || []);
    } catch (e) {
      try {
        const [sup, prod, spare, pza, serv, cli, ruc, unt] = await Promise.all([
          api.get('/suppliers/catalogo'),
          api.get('/products', { params: { page: 1, limit: 100 } }),
          api.get('/spare-parts', { params: { page: 1, limit: 100 } }),
          api.get('/piezas', { params: { page: 1, limit: 100 } }),
          api.get('/services', { params: { page: 1, limit: 100 } }),
          api.get('/clients', { params: { page: 1, limit: 100 } }),
          api.get('/clients-ruc', { params: { page: 1, limit: 100 } }),
          api.get('/units'),
        ]);
        setSuppliers(sup.data);
        setProducts(await fetchAll(prod));
        setSpares(await fetchAll(spare));
        setPiezas(await fetchAll(pza));
        setServices(await fetchAll(serv));
        setClients(await fetchAll(cli));
        setRucs(await fetchAll(ruc));
        setUnits(unt.data);
      } catch (e2) {
        setCatsError(true);
        toast.error(errMsg(e2));
      }
    } finally {
      setCatsLoading(false);
    }
  };

  const emptyForm = () => ({
    proveedor_id: '',
    proveedor_query: '',
    fecha_compra: new Date().toISOString().slice(0, 10),
    moneda: isIntl ? 'USD' : 'PEN',
    tipo_cambio: isIntl ? '' : '1',
    tipo_comprobante: 'FACTURA',
    serie_comprobante: '',
    numero_comprobante: '',
    con_igv: !isIntl,
    tasa_impuesto: '18',
    condiciones_pago: '',
    fecha_vencimiento: '',
    observaciones: '',
    cliente_tipo: '',
    cliente_id: '',
    items: [],
  });

  const blankItem = (kind) => ({
    kind,
    product_id: '', spare_part_id: '', pieza_id: '', codigo: '', descripcion: '',
    cantidad: '1', unidad: 'UND', precio_unitario: '', descuento: '0',
    peso_kg: '', volumen_m3: '',
    destino: kind === 'manual' ? 'OTRO' : 'STOCK',
    cliente_tipo: 'RUC', cliente_id: '',
    trabajo_tipo: '', trabajo_id: '', trabajo_desc: '',
    utilizacion: '',
  });

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    loadCatalogs();
    setModal(true);
  };

  const openEdit = async (p) => {
    setViewBusy(true);
    try {
      const r = await api.get(`/purchases/${p.id}`);
      const d = r.data;
      setEditingId(p.id);
      setForm({
        proveedor_id: d.proveedor_id || '',
        proveedor_query: d.supplier?.numero_documento || '',
        fecha_compra: (d.fecha_compra || '').slice(0, 10),
        moneda: d.moneda || 'PEN',
        tipo_cambio: d.tipo_cambio != null ? String(d.tipo_cambio) : '',
        tipo_comprobante: d.tipo_comprobante || (isIntl ? '' : 'FACTURA'),
        serie_comprobante: d.serie_comprobante || '',
        numero_comprobante: d.numero_comprobante || '',
        con_igv: !!d.con_igv,
        tasa_impuesto: d.tasa_impuesto != null ? String(Number(d.tasa_impuesto) * 100) : '18',
        condiciones_pago: d.condiciones_pago || '',
        fecha_vencimiento: (d.fecha_vencimiento || '').slice(0, 10),
        observaciones: d.observaciones || '',
        cliente_tipo: d.cliente_tipo || '',
        cliente_id: d.cliente_id != null ? String(d.cliente_id) : '',
        items: (d.items || []).map((i) => ({
          kind: i.product_id ? 'product' : i.spare_part_id ? 'spare' : i.pieza_id ? 'pieza' : 'manual',
          product_id: i.product_id || '',
          spare_part_id: i.spare_part_id || '',
          pieza_id: i.pieza_id || '',
          codigo: i.codigo || '',
          descripcion: i.descripcion || '',
          cantidad: String(i.cantidad ?? 1),
          unidad: i.unidad || 'UND',
          precio_unitario: String(i.precio_unitario ?? 0),
          descuento: String(i.descuento ?? 0),
          peso_kg: i.peso_kg != null ? String(i.peso_kg) : '',
          volumen_m3: i.volumen_m3 != null ? String(i.volumen_m3) : '',
          destino: i.destino || 'OTRO',
          cliente_tipo: i.cliente_tipo || 'RUC',
          cliente_id: i.cliente_id != null ? String(i.cliente_id) : '',
          trabajo_tipo: i.trabajo_tipo || '',
          trabajo_id: i.trabajo_id != null ? String(i.trabajo_id) : '',
          trabajo_desc: i.trabajo_desc || '',
          utilizacion: i.utilizacion || '',
        })),
      });
      loadCatalogs();
      setModal(true);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setViewBusy(false);
    }
  };

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItemField = (idx, k, v) =>
    setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === idx ? { ...it, [k]: v } : it)) }));

  const supplierList = (suppliers || []).filter((s) =>
    isIntl ? s.tipo_proveedor === 'EXTRANJERO' : s.tipo_proveedor === 'NACIONAL'
  );

  const onProveedorChange = (q) => {
    const t = (q || '').trim();
    const doc = t ? supplierList.find((s) => String(s.numero_documento || '').trim() === t) : null;
    const name = t ? supplierList.find((s) => String(s.razon_social || '').trim().toLowerCase() === t.toLowerCase()) : null;
    const sel = doc || name;
    setForm((f) => ({ ...f, proveedor_query: q, proveedor_id: sel ? sel.id : '' }));
  };

  const addItem = (kind) => setForm((f) => ({ ...f, items: [...f.items, blankItem(kind)] }));

  const removeItem = (idx) => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== idx) }));

  const pickItem = (idx, kind, selected) => {
    const cat = kind === 'product' ? products || [] : kind === 'spare' ? spares || [] : piezas || [];
    const found = cat.find((c) => String(c.id) === String(selected));
    if (!found) return;
    setForm((f) => ({
      ...f,
      items: f.items.map((it, j) => (j === idx ? {
        ...it,
        kind,
        product_id: kind === 'product' ? found.id : it.product_id,
        spare_part_id: kind === 'spare' ? found.id : it.spare_part_id,
        pieza_id: kind === 'pieza' ? found.id : it.pieza_id,
        codigo: found.codigo || found.code || it.codigo || '',
        descripcion: found.name || found.descripcion || it.descripcion || '',
        precio_unitario: found.price != null ? String(found.price) : it.precio_unitario,
        unidad: it.unidad || 'UND',
      } : it)),
    }));
  };

  const setItemKind = (idx, kind) => setForm((f) => ({
    ...f,
    items: f.items.map((it, j) => (j === idx ? { ...it, kind, product_id: '', spare_part_id: '', pieza_id: '' } : it)),
  }));

  const [piezaTarget, setPiezaTarget] = useState(null);

  const openPiezaCreate = (idx) => {
    setPiezaForm({ name: '', codigo: '', precio: '', unidad: 'UND' });
    setPiezaTarget(idx);
    setPiezaModal(true);
  };

  const crearPieza = async () => {
    if (!piezaForm.name.trim()) { toast.warning('Indica el nombre de la pieza'); return null; }
    if (piezaForm.precio === '' || Number(piezaForm.precio) <= 0) { toast.warning('El precio debe ser mayor a 0'); return null; }
    setPiezaBusy(true);
    try {
      const r = await api.post('/piezas', {
        codigo: piezaForm.codigo.trim() || null,
        name: piezaForm.name.trim(),
        precio: parseFloat(String(piezaForm.precio).replace(',', '.')),
        unidad: piezaForm.unidad || 'UND',
        stock: 0,
      });
      setPiezas((prev) => [...(prev || []), r.data]);
      toast.success('Pieza creada');
      return r.data;
    } catch (e) {
      toast.error(errMsg(e));
      return null;
    } finally {
      setPiezaBusy(false);
    }
  };

  const savePiezaForItem = async () => {
    const pz = await crearPieza();
    if (!pz || piezaTarget == null) return;
    setItemField(piezaTarget, 'kind', 'pieza');
    setItemField(piezaTarget, 'pieza_id', String(pz.id));
    setItemField(piezaTarget, 'codigo', pz.codigo || '');
    setItemField(piezaTarget, 'descripcion', pz.name);
    setItemField(piezaTarget, 'precio_unitario', String(pz.precio));
    setPiezaModal(false);
    setPiezaTarget(null);
  };

  const tasa = useMemo(() => {
    const v = Number(form?.tasa_impuesto);
    return isNaN(v) || v <= 0 ? 0 : v / 100;
  }, [form?.tasa_impuesto]);

  const computedItems = useMemo(() => {
    if (!form) return [];
    return form.items.map((it) => {
      const cantidad = Math.max(0, Number(it.cantidad) || 0);
      const precio = Math.max(0, Number(it.precio_unitario) || 0);
      const descuento = Math.max(0, Number(it.descuento) || 0);
      const bruto = cantidad * precio;
      const subtotal = Math.max(0, bruto - descuento);
      const impuesto = form.con_igv ? subtotal * tasa : 0;
      const total = subtotal + impuesto;
      return { ...it, cantidad, precio, descuento, bruto, subtotal, impuesto, total };
    });
  }, [form, tasa]);

  const subtotal = computedItems.reduce((a, i) => a + i.subtotal, 0);
  const impuestos = computedItems.reduce((a, i) => a + i.impuesto, 0);
  const total = subtotal + impuestos;

  const clienteOpciones = (tipoDoc) =>
    (tipoDoc === 'RUC' ? rucs || [] : clients || []).map((c) => ({
      id: c.id,
      label: tipoDoc === 'RUC'
        ? `${c.razonsocial || '—'}${c.ruc ? ` — ${c.ruc}` : ''}`
        : `${(c.names || '').trim()} ${(c.last_names || '').trim()}`.trim() + (c.dni ? ` — ${c.dni}` : ''),
    }));

  const buildPayload = () => ({
    tipo_compra: tipo,
    proveedor_id: Number(form.proveedor_id),
    fecha_compra: form.fecha_compra || new Date().toISOString().slice(0, 10),
    moneda: form.moneda,
    tipo_cambio: Number(form.tipo_cambio) || 1,
    tipo_comprobante: isIntl ? null : (form.tipo_comprobante || 'FACTURA'),
    serie_comprobante: form.serie_comprobante || null,
    numero_comprobante: form.numero_comprobante || null,
    con_igv: form.con_igv,
    tasa_impuesto: form.con_igv ? tasa || null : null,
    condiciones_pago: form.condiciones_pago || null,
    fecha_vencimiento: form.fecha_vencimiento || null,
    observaciones: form.observaciones || null,
    cliente_tipo: form.cliente_id ? (form.cliente_tipo || 'RUC') : null,
    cliente_id: form.cliente_id ? Number(form.cliente_id) : null,
    items: form.items.map((it) => ({
      product_id: it.kind === 'product' ? Number(it.product_id) : null,
      spare_part_id: it.kind === 'spare' ? Number(it.spare_part_id) : null,
      pieza_id: it.kind === 'pieza' ? Number(it.pieza_id) : null,
      codigo: it.codigo || null,
      descripcion: it.descripcion || it.codigo || null,
      cantidad: Number(it.cantidad) || 1,
      unidad: (it.unidad || 'UND').toUpperCase(),
      precio_unitario: Number(it.precio_unitario) || 0,
      descuento: Number(it.descuento) || 0,
      peso_kg: it.peso_kg !== '' && it.peso_kg != null ? Number(it.peso_kg) : null,
      volumen_m3: it.volumen_m3 !== '' && it.volumen_m3 != null ? Number(it.volumen_m3) : null,
      destino: it.destino || 'OTRO',
      cliente_tipo: it.destino === 'PARA_CLIENTE' ? (it.cliente_tipo || 'RUC') : null,
      cliente_id: it.destino === 'PARA_CLIENTE' && it.cliente_id ? Number(it.cliente_id) : null,
      trabajo_tipo: it.trabajo_tipo || null,
      trabajo_id: it.trabajo_tipo && it.trabajo_tipo !== 'MANUAL' && it.trabajo_id ? Number(it.trabajo_id) : null,
      trabajo_desc: it.trabajo_tipo === 'MANUAL' ? (it.trabajo_desc || it.descripcion || null) : null,
      utilizacion: it.utilizacion || null,
    })),
  });

  const validate = () => {
    if (!form.proveedor_id) return toast.warning('Selecciona o registra el proveedor (RUC)');
    if (form.moneda !== 'PEN' && (!form.tipo_cambio || Number(form.tipo_cambio) <= 0))
      return toast.warning('Indica un tipo de cambio mayor a 0');
    if (form.items.length === 0) return toast.warning('Agrega al menos un item');
    if (form.cliente_tipo && !form.cliente_id) return toast.warning('Selecciona el cliente de la compra');
    if (form.cliente_id && !['RUC', 'DNI'].includes(form.cliente_tipo)) return toast.warning('Indica el tipo de cliente (RUC/DNI) de la compra');
    for (const it of form.items) {
      if (it.kind !== 'manual' && !it[it.kind === 'product' ? 'product_id' : it.kind === 'spare' ? 'spare_part_id' : 'pieza_id'])
        return toast.warning('Completa los items de la compra');
      if (!it.descripcion && !it.codigo) return toast.warning('Completa la descripción de cada item');
      if (Number(it.cantidad) <= 0) return toast.warning('La cantidad debe ser mayor a 0');
      if (Number(it.precio_unitario) < 0) return toast.warning('El precio unitario no puede ser negativo');
      if (!it.unidad) return toast.warning('Indica la unidad de medida de cada item');
      if (it.destino === 'PARA_CLIENTE' && !it.cliente_id)
        return toast.warning('Para ítems "Para cliente" selecciona un cliente');
      if (it.trabajo_tipo === 'PRODUCTO' && !it.trabajo_id)
        return toast.warning('Selecciona el producto/trabajo del ítem');
      if (it.trabajo_tipo === 'SERVICIO' && !it.trabajo_id)
        return toast.warning('Selecciona el servicio del ítem');
      if (it.trabajo_tipo === 'MANUAL' && !it.trabajo_desc && !it.descripcion)
        return toast.warning('Describe el trabajo manual del ítem');
    }
    return true;
  };

  const save = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      const payload = buildPayload();
      if (editingId) {
        await api.put(`/purchases/${editingId}`, payload);
        toast.success('Compra actualizada');
      } else {
        await api.post('/purchases', payload);
        toast.success('Compra registrada correctamente');
      }
      setModal(false);
      reloadList();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const cancelPurchase = async (p) => {
    const ok = await ask({
      title: 'Cancelar compra',
      message: `¿Deseas cancelar la compra ${p.codigo_compra} de ${p.supplier?.razon_social || 'proveedor'}? La compra se marcará como CANCELADA.`,
      confirmText: 'Cancelar compra',
    });
    if (!ok) return;
    try {
      await api.post(`/purchases/${p.id}/cancel`, { motivo: 'Cancelada desde el panel' });
      toast.success('Compra cancelada');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const markAsPaid = async (p) => {
    const ok = await ask({
      title: 'Marcar como pagada',
      message: `¿Deseas marcar la compra ${p.codigo_compra} como PAGADA? Se registrará un pago por el monto total pendiente.`,
      confirmText: 'Marcar como pagada',
    });
    if (!ok) return;
    try {
      const now = new Date();
      const fechaPago = now.toISOString().slice(0, 10);
      const payload = {
        purchase_id: p.id,
        supplier_id: p.supplier?.id || p.proveedor_id,
        fecha_pago: fechaPago,
        moneda: p.moneda,
        monto: Number(p.saldo || p.total || 0),
        tipo_cambio: Number(p.tipo_cambio || 1),
        medio_pago: 'EFECTIVO',
        observaciones: `Pago registrado el ${now.toLocaleDateString('es-PE')} a las ${now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`,
      };
      await api.post('/supplier-payments', payload);
      toast.success('Compra marcada como pagada');
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const [payModal, setPayModal] = useState(null);

  const openView = (p) => {
    setView(null);
    setViewBusy(true);
    api.get(`/purchases/${p.id}`)
      .then((r) => setView(r.data))
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setViewBusy(false));
  };

  const { q, setQ, filtered } = useSearch(rows || [], SEARCH_KEYS);

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar las compras" /> : <Loader text="Cargando compras..." />;

  const selectedSupplier = form && (suppliers || []).find((s) => String(s.id) === String(form.proveedor_id));
  const proveedorNoRegistrado = form && form.proveedor_query.trim() && !selectedSupplier;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{isIntl ? 'Compras Exteriores' : 'Compras Interiores'}</h1>
          <div className="sub">{isIntl ? 'Compras internacionales: importaciones y mercadería del exterior' : 'Compras nacionales a proveedores locales'}</div>
        </div>
        {can('PURCHASES_CREATE') && (
          <button className="btn btn-primary btn-lg" onClick={openAdd}><Icon name="plus" size={17} /> Nueva compra</button>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="ico blue"><Icon name={isIntl ? 'globe' : 'tractor'} size={20} /></div>
          <div className="num">{pagination?.total || 0}</div>
          <div className="lbl">compras {isIntl ? 'exteriores' : 'interiores'} registradas</div>
        </div>
        <div className="stat-card">
          <div className="ico yellow"><Icon name="cash" size={20} /></div>
          <div className="num">
            {fmtAmount(rows.filter((r) => r.estado_pago === 'PENDIENTE' || r.estado_pago === 'PAGADA_PARCIAL').reduce((a, r) => a + Number(r.saldo), 0))}
          </div>
          <div className="lbl">saldo por pagar</div>
        </div>
        <div className="stat-card">
          <div className="ico red"><Icon name={isIntl ? 'globe' : 'tractor'} size={20} /></div>
          <div className="num">
            {rows.filter((r) => (r.destinos || []).includes('PARA_CLIENTE')).length}
          </div>
          <div className="lbl">{isIntl ? 'compras en tránsito' : 'compras para clientes'}</div>
        </div>
      </div>

      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar por código, proveedor, RUC, comprobante...">
          <select className="select" style={{ width: 'auto' }} value={estado} onChange={(e) => { setEstado(e.target.value); setPage(1); }}>
            <option value="">Todos los estados</option>
            {Object.keys(ESTADO_COMPRA_MAP).map((k) => <option key={k} value={k}>{ESTADO_COMPRA_MAP[k][1]}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={estadoPago} onChange={(e) => { setEstadoPago(e.target.value); setPage(1); }}>
            <option value="">Todos los pagos</option>
            {Object.keys(ESTADO_PAGO_MAP).map((k) => <option key={k} value={k}>{ESTADO_PAGO_MAP[k][1]}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={destino} onChange={(e) => { setDestino(e.target.value); setPage(1); }}>
            <option value="">Todos los destinos</option>
            {Object.keys(DESTINO_MAP).map((k) => <option key={k} value={k}>{DESTINO_MAP[k][1]}</option>)}
          </select>
          <span className="pill-count">{filtered.length} compras</span>
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Código</th>
                <th>Proveedor</th>
                <th>Fecha</th>
                <th>Destino</th>
                <th>Cliente</th>
                <th>Moneda</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Pago</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td data-label="Código">
                    <b style={{ color: 'var(--g-forest)' }}>{p.codigo_compra}</b>
                    {p.tipo_comprobante && (
                      <div className="text-muted" style={{ fontSize: 11.5 }}>
                        {p.tipo_comprobante}{p.serie_comprobante ? ` · ${p.serie_comprobante}-${p.numero_comprobante || ''}` : ''}
                      </div>
                    )}
                    {isIntl && (
                      <div className="text-muted" style={{ fontSize: 11.5 }}>
                        Eq. {fmtAmount(p.total_equivalente)}
                      </div>
                    )}
                  </td>
                  <td data-label="Proveedor" style={{ maxWidth: 240 }}>
                    <div className="cell-title">{p.supplier?.razon_social || '—'}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      {p.supplier?.tipo_documento ? `${p.supplier.tipo_documento} ` : ''}{p.supplier?.numero_documento || ''}
                    </div>
                    {p.supplier?.pais && <div className="text-muted" style={{ fontSize: 12 }}>{p.supplier.pais}</div>}
                  </td>
                  <td data-label="Fecha" className="text-muted">{fmtDate(p.fecha_compra)}</td>
                  <td data-label="Destino">
                    <div className="flex" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {(p.destinos || []).map((d) => {
                        const [k, l] = DESTINO_MAP[d] || ['gray', d];
                        return <Badge key={d} kind={k}>{l}</Badge>;
                      })}
                    </div>
                  </td>
                  <td data-label="Cliente" className="text-muted" style={{ maxWidth: 180 }}>
                    {(p.clientes || []).join(', ') || '—'}
                  </td>
                  <td data-label="Moneda"><Badge kind="gray">{p.moneda}</Badge></td>
                  <td data-label="Total" className="money">
                    <b>{fmtAmount(p.total, p.moneda)}</b>
                    {Number(p.saldo) > 0 && (
                      <div className="text-muted" style={{ fontSize: 11.5 }}>
                        Saldo {fmtAmount(p.saldo, p.moneda)}
                      </div>
                    )}
                  </td>
                  <td data-label="Estado">
                    {(() => { const [k, l] = ESTADO_COMPRA_MAP[p.estado] || ['gray', p.estado]; return <Badge kind={k}>{l}</Badge>; })()}
                  </td>
                  <td data-label="Pago">
                    {(() => { const [k, l] = ESTADO_PAGO_MAP[p.estado_pago] || ['gray', p.estado_pago]; return <Badge kind={k}>{l}</Badge>; })()}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-icon" onClick={() => openView(p)} title="Ver detalle"><Icon name="visible" size={14} /></button>
                      {can('SUPPLIER_PAYMENTS_CREATE') && p.estado !== 'CANCELADA' && Number(p.saldo || 0) > 0 && (
                        <button 
                          className="btn-icon" 
                          style={{ background: 'var(--g-soft)', color: 'var(--g-dark)', border: '1px solid var(--g-primary)' }}
                          onClick={() => setPayModal(p)} 
                          title="Registrar pago (parcial o total)"
                        >
                          <Icon name="cash" size={14} />
                        </button>
                      )}
                      {can('SUPPLIER_PAYMENTS_CREATE') && p.estado_pago !== 'PAGADO' && Number(p.saldo || 0) > 0 && p.estado !== 'CANCELADA' && (
                        <button 
                          className="btn-icon" 
                          style={{ background: 'var(--g-soft)', color: 'var(--g-dark)', border: '1px solid var(--g-primary)' }}
                          onClick={() => markAsPaid(p)} 
                          title="Marcar como pagada (pago total)"
                        >
                          <Icon name="money" size={14} />
                        </button>
                      )}
                      {can('PURCHASES_UPDATE') && p.estado !== 'CANCELADA' && (
                        <button className="btn-icon" onClick={() => openEdit(p)} title="Editar"><Icon name="edit" size={14} /></button>
                      )}
                      {can('PURCHASES_DELETE') && p.estado !== 'CANCELADA' && (
                        <button className="btn-icon danger" onClick={() => cancelPurchase(p)} title="Cancelar"><Icon name="cancel" size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title={q || estado || estadoPago || destino || moneda ? 'Sin coincidencias' : 'No hay compras'} hint={`Registra tu primera compra${isIntl ? ' exterior' : ' interior'}`} />}
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

      {/* Formulario nueva / editar compra */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editingId ? 'Editar compra' : (isIntl ? 'Nueva compra exterior' : 'Nueva compra interior')}
        icon={<Icon name={isIntl ? 'globe' : 'tractor'} size={18} />}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={busy} style={{ justifyContent: 'center', minWidth: 210 }}>
              {busy ? <span className="spinner" /> : <Icon name="save" size={15} />} Guardar compra <b className="money" style={{ marginLeft: 4 }}>({fmtAmount(total, form?.moneda || 'PEN')})</b>
            </button>
          </>
        }
      >
        {form && (
          <>
            {!suppliers && (
              <div className="text-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                {catsError ? (
                  <button className="btn btn-outline btn-sm" onClick={loadCatalogs}><Icon name="undo" size={13} /> Reintentar carga de catálogos</button>
                ) : (
                  <><span className="spinner" style={{ verticalAlign: -2 }} /> Cargando proveedores, catálogos y clientes...</>
                )}
              </div>
            )}
            <div className="grid-3">
              <div className="field">
                <label>Proveedor (RUC o nombre) <span className="req">*</span></label>
                <input
                  className="input"
                  list="proveedores-list"
                  placeholder="Buscar por RUC o razón social..."
                  value={form.proveedor_query}
                  onChange={(e) => onProveedorChange(e.target.value)}
                />
                <datalist id="proveedores-list">
                  {supplierList.map((s) => [
                    s.numero_documento && <option key={`d${s.id}`} value={s.numero_documento}>{s.razon_social} — {s.numero_documento}</option>,
                    <option key={`n${s.id}`} value={s.razon_social}>{s.numero_documento ? `${s.numero_documento} — ` : ''}{s.razon_social}</option>,
                  ])}
                </datalist>
                {proveedorNoRegistrado && (
                  <div className="text-danger" style={{ fontSize: 12, marginTop: 4 }}>
                    RUC no registrado. <Link to="/proveedores" style={{ color: 'inherit', textDecoration: 'underline' }}>Registrar proveedor</Link>
                  </div>
                )}
              </div>
              <div className="field">
                <label>Fecha de compra</label>
                <input className="input" type="date" value={form.fecha_compra} onChange={(e) => setField('fecha_compra', e.target.value)} />
              </div>
              <div className="field">
                <label>Moneda</label>
                <select className="select" value={form.moneda} onChange={(e) => { setField('moneda', e.target.value); if (e.target.value === 'PEN') setField('tipo_cambio', '1'); }}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c} ({CURR_SYM[c]})</option>)}
                </select>
              </div>
            </div>

            {!!form && (
              <div className="grid-3" style={{ marginTop: 2 }}>
                <div className="field">
                  <label>Cliente de la compra</label>
                  <select className="select" value={form.cliente_tipo} onChange={(e) => { setField('cliente_tipo', e.target.value); setField('cliente_id', ''); }}>
                    <option value="">— Ninguno —</option>
                    <option value="RUC">Empresa (RUC)</option>
                    <option value="DNI">Persona (DNI)</option>
                  </select>
                </div>
                <div className="field" style={{ gridColumn: 'span 2' }}>
                  <label>Cliente vinculado (opcional)</label>
                  <select
                    className="select"
                    value={form.cliente_id}
                    onChange={(e) => setField('cliente_id', e.target.value)}
                    disabled={!form.cliente_tipo}
                  >
                    <option value="">— Seleccionar cliente —</option>
                    {form.cliente_tipo && clienteOpciones(form.cliente_tipo).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            {!isIntl && (
              <div className="grid-3">
                <div className="field">
                  <label>Comprobante <span className="req">*</span></label>
                  <select className="select" value={form.tipo_comprobante} onChange={(e) => setField('tipo_comprobante', e.target.value)}>
                    {TIPO_COMPROBANTE_OPTS.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Serie</label>
                  <input className="input" placeholder="Ej. F001" value={form.serie_comprobante} onChange={(e) => setField('serie_comprobante', e.target.value)} />
                </div>
                <div className="field">
                  <label>Número</label>
                  <input className="input" placeholder="Ej. 00001234" value={form.numero_comprobante} onChange={(e) => setField('numero_comprobante', e.target.value)} />
                </div>
              </div>
            )}

            <div className="grid-3">
              <div className="field">
                <label>{isIntl ? 'Tipo de cambio' : 'Tipo de cambio (solo no-PEN)'}</label>
                <input className="input" type="number" min="0" step="0.0001" placeholder={form.moneda === 'PEN' ? '1' : 'Ej. 3.72'} value={form.tipo_cambio} onChange={(e) => setField('tipo_cambio', e.target.value)} disabled={form.moneda === 'PEN'} />
              </div>
              <div className="field">
                <label>Condiciones de pago</label>
                <input className="input" placeholder="Ej. Contado, 30 días" value={form.condiciones_pago} onChange={(e) => setField('condiciones_pago', e.target.value)} />
              </div>
              <div className="field">
                <label>Fecha de vencimiento</label>
                <input className="input" type="date" value={form.fecha_vencimiento} onChange={(e) => setField('fecha_vencimiento', e.target.value)} />
              </div>
            </div>

            {selectedSupplier && (
              <div className="quick-phone">
                <Icon name="building" size={15} />
                <span>
                  <b>{selectedSupplier.razon_social}</b> — {selectedSupplier.tipo_proveedor}
                  {selectedSupplier.pais ? ` · ${selectedSupplier.pais}` : ''}. Moneda principal: {selectedSupplier.moneda_principal || 'PEN'}
                </span>
              </div>
            )}

            <div className="flex" style={{ gap: 16, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <label className="check">
                <input type="checkbox" checked={form.con_igv} onChange={(e) => setField('con_igv', e.target.checked)} />
                Afecta IGV ({Number(form.tasa_impuesto) || 18}%)
              </label>
              <div className="field" style={{ width: 120, margin: 0 }}>
                <input className="input" type="number" min="0" step="0.1" placeholder="IGV %" value={form.tasa_impuesto} onChange={(e) => setField('tasa_impuesto', e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label>Items de la compra</label>
              <div className="sale-items">
                {computedItems.length === 0 && (
                  <div style={{ color: 'var(--faint)', fontSize: 12.5, padding: '18px', textAlign: 'center' }}>
                    Sin items — agrega uno con los botones de abajo
                  </div>
                )}
                {computedItems.map((it, idx) => (
                  <div key={idx} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, marginBottom: 8, minWidth: 560 }}>
                    <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      <select className="select" style={{ width: 140 }} value={it.kind} onChange={(e) => setItemKind(idx, e.target.value)}>
                        <option value="product">Producto</option>
                        <option value="spare">Repuesto</option>
                        <option value="pieza">Pieza</option>
                        <option value="manual">Manual</option>
                      </select>
                      <input className="input" style={{ flex: 1 }} placeholder="Código" value={it.codigo} onChange={(e) => setItemField(idx, 'codigo', e.target.value)} />
                    </div>
                    {it.kind === 'manual' ? (
                      <input className="input" style={{ marginBottom: 8, width: '100%' }} placeholder="Descripción del item" value={it.descripcion} onChange={(e) => setItemField(idx, 'descripcion', e.target.value)} />
                    ) : it.kind === 'pieza' ? (
                      <div className="flex" style={{ gap: 6, marginBottom: 8 }}>
                        <select className="select" style={{ flex: 1 }} value={it.pieza_id} onChange={(e) => pickItem(idx, 'pieza', e.target.value)}>
                          <option value="">— Seleccionar pieza a utilizar —</option>
                          {(piezas || []).map((c) => (
                            <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} — ` : ''}{c.name} — {fmtAmount(c.precio)}</option>
                          ))}
                        </select>
                        {can('PIEZAS_CREATE') && (
                          <button className="btn btn-outline btn-sm" onClick={() => openPiezaCreate(idx)} title="Registrar nueva pieza"><Icon name="plus" size={13} /> Nueva</button>
                        )}
                      </div>
                    ) : (
                      <select className="select" style={{ marginBottom: 8, width: '100%' }} value={it[it.kind === 'product' ? 'product_id' : 'spare_part_id']} onChange={(e) => pickItem(idx, it.kind, e.target.value)}>
                        <option value="">— Seleccionar {it.kind === 'product' ? 'producto' : 'repuesto'} —</option>
                        {(it.kind === 'product' ? products || [] : spares || []).map((c) => (
                          <option key={c.id} value={c.id}>{c.name} — {fmtAmount(c.price)}</option>
                        ))}
                      </select>
                    )}

                    <div className="grid-4">
                      <div className="field" style={{ margin: 0 }}>
                        <label>Cant.</label>
                        <input className="input" type="number" min="0.01" step="0.01" value={it.cantidad} onChange={(e) => setItemField(idx, 'cantidad', e.target.value)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label>P. Unit.</label>
                        <input className="input" type="number" min="0" step="0.01" value={it.precio_unitario} onChange={(e) => setItemField(idx, 'precio_unitario', e.target.value)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label>Dscto.</label>
                        <input className="input" type="number" min="0" step="0.01" value={it.descuento} onChange={(e) => setItemField(idx, 'descuento', e.target.value)} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label>Subtotal</label>
                        <div className="money" style={{ paddingTop: 8 }}>{fmtAmount(it.subtotal, form.moneda)}</div>
                      </div>
                    </div>
                    {isIntl && (
                      <div className="grid-2" style={{ marginTop: 8 }}>
                        <input className="input" type="number" min="0" step="0.001" placeholder="Peso kg" value={it.peso_kg} onChange={(e) => setItemField(idx, 'peso_kg', e.target.value)} />
                        <input className="input" type="number" min="0" step="0.001" placeholder="Vol. m³" value={it.volumen_m3} onChange={(e) => setItemField(idx, 'volumen_m3', e.target.value)} />
                      </div>
                    )}

                    <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                      <div className="field" style={{ margin: 0, flex: 1, minWidth: 130 }}>
                        <label>Destino <span className="req">*</span></label>
                        <select className="select" value={it.destino} onChange={(e) => setItemField(idx, 'destino', e.target.value)}>
                          {Object.keys(DESTINO_MAP).map((d) => <option key={d} value={d}>{DESTINO_MAP[d][1]}</option>)}
                        </select>
                      </div>
                      <div className="field" style={{ margin: 0, flex: 1, minWidth: 130 }}>
                        <label>Unidad <span className="req">*</span></label>
                        <select className="select" value={it.unidad} onChange={(e) => setItemField(idx, 'unidad', e.target.value)}>
                          {(units || DEFAULT_UNITS).map((u) => <option key={u.code || u} value={u.code || u}>{u.name || u}</option>)}
                        </select>
                      </div>
                      {it.destino === 'PARA_CLIENTE' && (
                        <>
                          <div className="field" style={{ margin: 0, width: 130 }}>
                            <label>Cliente tipo <span className="req">*</span></label>
                            <select className="select" value={it.cliente_tipo} onChange={(e) => setItemField(idx, 'cliente_tipo', e.target.value)}>
                              <option value="RUC">Empresa (RUC)</option>
                              <option value="DNI">Persona (DNI)</option>
                            </select>
                          </div>
                          <div className="field" style={{ margin: 0, flex: 2, minWidth: 200 }}>
                            <label>Cliente <span className="req">*</span></label>
                            <select className="select" value={it.cliente_id} onChange={(e) => setItemField(idx, 'cliente_id', e.target.value)}>
                              <option value="">— Seleccionar cliente —</option>
                              {clienteOpciones(it.cliente_tipo).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                      <div className="field" style={{ margin: 0, width: 190 }}>
                        <label>Producto / Trabajo</label>
                        <select className="select" value={it.trabajo_tipo} onChange={(e) => setItemField(idx, 'trabajo_tipo', e.target.value)}>
                          <option value="">— Ninguno —</option>
                          <option value="PRODUCTO">Producto</option>
                          <option value="SERVICIO">Servicio</option>
                          <option value="MANUAL">Manual</option>
                        </select>
                      </div>
                      {it.trabajo_tipo === 'PRODUCTO' && (
                        <div className="field" style={{ margin: 0, flex: 1, minWidth: 190 }}>
                          <label>Producto del trabajo</label>
                          <select className="select" value={it.trabajo_id} onChange={(e) => setItemField(idx, 'trabajo_id', e.target.value)}>
                            <option value="">— Seleccionar producto —</option>
                            {(products || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      )}
                      {it.trabajo_tipo === 'SERVICIO' && (
                        <div className="field" style={{ margin: 0, flex: 1, minWidth: 190 }}>
                          <label>Servicio del trabajo</label>
                          <select className="select" value={it.trabajo_id} onChange={(e) => setItemField(idx, 'trabajo_id', e.target.value)}>
                            <option value="">— Seleccionar servicio —</option>
                            {(services || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      )}
                      {it.trabajo_tipo === 'MANUAL' && (
                        <div className="field" style={{ margin: 0, flex: 1, minWidth: 190 }}>
                          <label>Descripción del trabajo</label>
                          <input className="input" placeholder="Ej. Servicio de soldadura" value={it.trabajo_desc} onChange={(e) => setItemField(idx, 'trabajo_desc', e.target.value)} />
                        </div>
                      )}
                      <div className="field" style={{ margin: 0, flex: 1, minWidth: 190 }}>
                        <label>Utilización</label>
                        <input className="input" placeholder="¿Para qué se usará? (opcional)" value={it.utilizacion} onChange={(e) => setItemField(idx, 'utilizacion', e.target.value)} />
                      </div>
                    </div>

                    <div className="flex-between" style={{ marginTop: 8 }}>
                      <span className="text-muted" style={{ fontSize: 12.5 }}>
                        Total ítem: <b className="money">{fmtAmount(it.total, form.moneda)}</b>
                      </span>
                      <button className="btn-icon danger" onClick={() => removeItem(idx)} title="Quitar item"><Icon name="trash" size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-outline btn-sm" onClick={() => addItem('product')}><Icon name="plus" size={13} /> Producto</button>
                <button className="btn btn-outline btn-sm" onClick={() => addItem('spare')}><Icon name="plus" size={13} /> Repuesto</button>
                <button className="btn btn-outline btn-sm" onClick={() => addItem('pieza')}><Icon name="plus" size={13} /> Pieza</button>
                <button className="btn btn-outline btn-sm" onClick={() => addItem('manual')}><Icon name="plus" size={13} /> Item manual</button>
              </div>
            </div>

            <div className="sale-summary" style={{ maxWidth: 340, marginLeft: 'auto' }}>
              <div className="line"><span className="text-muted">Subtotal</span><span className="money">{fmtAmount(subtotal, form.moneda)}</span></div>
              <div className="line"><span className="text-muted">Impuestos {form.con_igv ? `(${Number(form.tasa_impuesto) || 18}%)` : ''}</span><span className="money">{fmtAmount(impuestos, form.moneda)}</span></div>
              <div className="line total"><span>Total</span><span className="money">{fmtAmount(total, form.moneda)}</span></div>
              {form.moneda !== 'PEN' && (
                <div className="line"><span className="text-muted">Eq. soles (TC {Number(form.tipo_cambio) || 1})</span><span className="money">{fmtAmount(total * (Number(form.tipo_cambio) || 1))}</span></div>
              )}
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <label>Observaciones</label>
              <textarea className="textarea" rows={2} placeholder="Notas sobre la compra" value={form.observaciones} onChange={(e) => setField('observaciones', e.target.value)} />
            </div>
          </>
        )}
      </Modal>

      {/* Nueva pieza al vuelo */}
      <Modal
        open={piezaModal}
        onClose={() => setPiezaModal(false)}
        title="Registrar nueva pieza"
        icon={<Icon name="ruler" size={18} />}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setPiezaModal(false)}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-yellow" onClick={savePiezaForItem} disabled={piezaBusy}>
              {piezaBusy ? <span className="spinner" /> : <Icon name="save" size={15} />} Crear pieza
            </button>
          </>
        }
      >
        <div className="grid-2">
          <div className="field">
            <label>Nombre <span className="req">*</span></label>
            <input className="input" placeholder="Ej. Eje de transmisión" value={piezaForm.name} onChange={(e) => setPiezaForm({ ...piezaForm, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Código</label>
            <input className="input" placeholder="Ej. PZ-001" value={piezaForm.codigo} onChange={(e) => setPiezaForm({ ...piezaForm, codigo: e.target.value })} />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Precio (S/) <span className="req">*</span></label>
            <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={piezaForm.precio} onChange={(e) => setPiezaForm({ ...piezaForm, precio: e.target.value })} />
          </div>
          <div className="field">
            <label>Unidad</label>
            <select className="select" value={piezaForm.unidad} onChange={(e) => setPiezaForm({ ...piezaForm, unidad: e.target.value })}>
              {DEFAULT_UNITS.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}
            </select>
          </div>
        </div>
      </Modal>

      {/* Detalle de compra */}
      <Modal
        open={viewBusy || !!view}
        onClose={() => { setView(null); setViewBusy(false); }}
        title="Detalle de la compra"
        icon={<Icon name={isIntl ? 'globe' : 'tractor'} size={18} />}
        size="lg"
        footer={<button className="btn btn-primary" onClick={() => { setView(null); setViewBusy(false); }}>Entendido</button>}
      >
        {viewBusy && !view && <Loader text="Cargando detalle..." />}
        {view && (
          <div style={{ fontSize: 13.5 }}>
            {/* Header con info principal */}
            <div style={{ 
              padding: 18, 
              background: 'linear-gradient(135deg, var(--g-soft), var(--g-softer))',
              border: '1px solid var(--line)',
              borderRadius: 12,
              marginBottom: 20
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--g-forest)', marginBottom: 8, fontFamily: 'monospace' }}>
                    {view.codigo_compra}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    {(() => { const [k, l] = ESTADO_COMPRA_MAP[view.estado] || ['gray', view.estado]; return <Badge kind={k}>{l}</Badge>; })()}
                    {(() => { const [k, l] = ESTADO_PAGO_MAP[view.estado_pago] || ['gray', view.estado_pago]; return <Badge kind={k}>{l}</Badge>; })()}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                    <div><Icon name="calendar" size={12} style={{ marginRight: 4 }} /><strong>Fecha:</strong> {fmtDate(view.fecha_compra)}</div>
                    <div><Icon name="money" size={12} style={{ marginRight: 4 }} /><strong>Moneda:</strong> {view.moneda}</div>
                    {view.tipo_comprobante && (
                      <div><Icon name="document" size={12} style={{ marginRight: 4 }} /><strong>Comprobante:</strong> {view.tipo_comprobante}{view.serie_comprobante ? ` ${view.serie_comprobante}-${view.numero_comprobante || ''}` : ''}</div>
                    )}
                  </div>
                </div>
                <div style={{ 
                  textAlign: 'right',
                  padding: 16,
                  background: '#fff',
                  borderRadius: 10,
                  border: '2px solid var(--g-primary)',
                  minWidth: 160
                }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Total</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--g-forest)', fontFamily: 'monospace', lineHeight: 1 }}>
                    {fmtAmount(view.total, view.moneda)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Eq. {fmtAmount(view.total_equivalente)}</div>
                </div>
              </div>
            </div>

            {/* Información en cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              {/* Proveedor */}
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
                  <Icon name="building" size={14} /> Proveedor
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                  <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
                    {view.supplier?.razon_social || '—'}
                  </div>
                  {view.supplier?.numero_documento && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {view.supplier.tipo_documento}: {view.supplier.numero_documento}
                    </div>
                  )}
                  {view.supplier?.pais && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      <Icon name="location" size={12} style={{ marginRight: 4 }} />{view.supplier.pais}
                    </div>
                  )}
                  {view.cliente_compra && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)', fontSize: 12 }}>
                      <span style={{ color: 'var(--muted)' }}>Cliente:</span> <strong>{view.cliente_compra}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Pagos */}
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
                  <Icon name="money" size={14} /> Pagos
                </div>
                <div style={{ fontSize: 13, lineHeight: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8 }}>
                    <span style={{ color: 'var(--muted)' }}>Total pagado</span>
                    <strong style={{ fontFamily: 'monospace' }}>{fmtAmount(view.total_pagado, view.moneda)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
                    <span style={{ color: 'var(--muted)' }}>Saldo</span>
                    <strong style={{ 
                      fontFamily: 'monospace',
                      color: Number(view.saldo) > 0 ? 'var(--danger)' : 'var(--g-primary)'
                    }}>
                      {fmtAmount(view.saldo, view.moneda)}
                    </strong>
                  </div>
                  {view.condiciones_pago && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                      <strong>Condiciones:</strong> {view.condiciones_pago}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Items */}
            <div style={{ marginBottom: 20 }}>
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
                <Icon name="list" size={16} /> Items de la compra
              </div>
              <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                <table className="data" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Descripción</th>
                      <th>Destino</th>
                      <th>Cliente / Trabajo</th>
                      <th style={{ textAlign: 'center' }}>Cant.</th>
                      <th style={{ textAlign: 'right' }}>P. Unit.</th>
                      <th style={{ textAlign: 'right' }}>Dscto.</th>
                      <th style={{ textAlign: 'right' }}>Subtotal</th>
                      <th style={{ textAlign: 'right' }}>Imp.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(view.items || []).map((i, idx) => (
                      <tr key={i.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
                            {i.product_name || i.spare_part_name || i.pieza_name || i.descripcion || i.codigo || `Item ${idx + 1}`}
                          </div>
                          {i.codigo && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Código: {i.codigo}</div>}
                          {i.utilizacion && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Uso: {i.utilizacion}</div>}
                        </td>
                        <td>
                          {(() => { const [k, l] = DESTINO_MAP[i.destino] || ['gray', i.destino || 'OTRO']; return <Badge kind={k}>{l}</Badge>; })()}
                        </td>
                        <td style={{ maxWidth: 180 }}>
                          {i.cliente_nombre && <div style={{ fontWeight: 600, fontSize: 11.5 }}>{i.cliente_nombre}</div>}
                          {i.pieza_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Pieza: {i.pieza_name}</div>}
                          {i.trabajo_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{i.trabajo_name}</div>}
                          {i.trabajo_desc && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{i.trabajo_desc}</div>}
                          {!i.cliente_nombre && !i.trabajo_name && !i.trabajo_desc && <span style={{ color: 'var(--muted)' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{i.cantidad} {i.unidad}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtAmount(i.precio_unitario, view.moneda)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--muted)' }}>{Number(i.descuento) ? fmtAmount(i.descuento, view.moneda) : '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtAmount(i.subtotal, view.moneda)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--muted)' }}>{fmtAmount(i.impuesto, view.moneda)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Resumen de totales */}
              <div style={{ 
                maxWidth: 320, 
                marginLeft: 'auto', 
                marginTop: 12,
                padding: 14,
                background: 'var(--g-softer)',
                border: '1px solid var(--line)',
                borderRadius: 8
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                  <span style={{ color: 'var(--muted)' }}>Subtotal</span>
                  <span style={{ fontFamily: 'monospace' }}>{fmtAmount(view.subtotal, view.moneda)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                  <span style={{ color: 'var(--muted)' }}>Impuestos</span>
                  <span style={{ fontFamily: 'monospace' }}>{fmtAmount(view.impuestos, view.moneda)}</span>
                </div>
                {Number(view.costos_adicionales) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                    <span style={{ color: 'var(--muted)' }}>Costos adicionales</span>
                    <span style={{ fontFamily: 'monospace' }}>{fmtAmount(view.costos_adicionales, view.moneda)}</span>
                  </div>
                )}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  paddingTop: 8, 
                  marginTop: 8,
                  borderTop: '2px solid var(--g-primary)',
                  fontSize: 15,
                  fontWeight: 700
                }}>
                  <span>Total</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--g-forest)' }}>{fmtAmount(view.total, view.moneda)}</span>
                </div>
              </div>
            </div>

            {/* Costos de importación */}
            {view.costs && view.costs.length > 0 && (
              <div style={{ marginBottom: 20 }}>
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
                  <Icon name="globe" size={16} /> Costos de importación
                </div>
                <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 8 }}>
                  <table className="data" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Concepto</th>
                        <th>Método</th>
                        <th style={{ textAlign: 'right' }}>Monto</th>
                        <th>Moneda</th>
                        <th style={{ textAlign: 'right' }}>Eq. soles</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.costs.map((c) => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 600 }}>{c.concepto}</td>
                          <td><Badge kind="gray">{c.metodo_distribucion}</Badge></td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtAmount(c.monto, c.moneda || view.moneda)}</td>
                          <td><Badge kind="gray">{c.moneda || view.moneda}</Badge></td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtAmount(c.monto_equivalente)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Pagos registrados */}
            {view.payments && view.payments.length > 0 && (
              <div style={{ marginBottom: 20 }}>
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
                  <Icon name="credit-card" size={16} /> Pagos registrados
                </div>
                <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 8 }}>
                  <table className="data" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Medio</th>
                        <th style={{ textAlign: 'right' }}>Monto</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.payments.map((pay) => (
                        <tr key={pay.id}>
                          <td>{fmtDate(pay.fecha_pago)}</td>
                          <td><Badge kind="gray">{pay.medio_pago}</Badge></td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtAmount(pay.monto, view.moneda)}</td>
                          <td>{pay.anulado ? <Badge kind="red">Anulado</Badge> : <Badge kind="green">Pagado</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recepciones */}
            {view.receipts && view.receipts.length > 0 && (
              <div style={{ marginBottom: 20 }}>
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
                  <Icon name="package" size={16} /> Recepciones
                </div>
                <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 8 }}>
                  <table className="data" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Fecha</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.receipts.map((r) => (
                        <tr key={r.id}>
                          <td><strong style={{ color: 'var(--g-forest)', fontFamily: 'monospace' }}>{r.codigo_recepcion}</strong></td>
                          <td>{fmtDate(r.fecha_recepcion)}</td>
                          <td><Badge kind="green">{r.estado}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Observaciones */}
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

            {/* Historial */}
            {view.history && view.history.length > 0 && (
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
                  <Icon name="time" size={16} /> Historial
                </div>
                <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 8 }}>
                  <table className="data" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Evento</th>
                        <th>Descripción</th>
                        <th>Usuario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.history.map((h) => (
                        <tr key={h.id}>
                          <td style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDateTime(h.created_at)}</td>
                          <td><Badge kind="gray">{h.evento}</Badge></td>
                          <td style={{ color: 'var(--muted)' }}>{h.descripcion || '—'}</td>
                          <td style={{ color: 'var(--muted)', fontSize: 11 }}>{h.user_email || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <PaymentModal
        open={!!payModal}
        onClose={() => setPayModal(null)}
        purchase={payModal}
        onDone={() => load()}
      />

      {ConfirmDialog}
    </>
  );
}