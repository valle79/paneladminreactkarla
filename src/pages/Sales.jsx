import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { api, errMsg, uploadFile } from '../api';
import { useToast } from '../components/Toast';
import { Modal, useConfirm } from '../components/Modal';
import ProformaModal, { ProformaDocument } from '../components/Proforma';
import { buildDocumentPdfBlob } from '../components/DocPdf';
import {
  Toolbar, useSearch, useListReload, Loader, EmptyState, ErrorState, fmtMoney, fmtDateTime, fmtDate,
  StatusBadge, DocTypeBadge, InvoiceBadge,
} from '../components/ui';
import { Pagination } from '../components/Pagination';
import { COMPANY, formatDocNumber } from '../config';
import { useAuth } from '../auth';

const emptySale = {
  client_type: 'dni',
  client_id: '',
  advisor_id: '',
  invoice_type: 'boleta',
  invoice_number: '',
  with_igv: true,
  payment_status: 'pagado',
  payment_description: '',
  payment_date: '',
  amount_paid: '',
  pending_payment_date: '',
  items: [],
};

const TYPE_ORDER = { machine: 0, repuesto: 1, service: 2, manual: 3 };
const ITEM_TYPES = [
  { value: 'machine', label: 'Productos' },
  { value: 'repuesto', label: 'Repuestos' },
  { value: 'service', label: 'Servicios' },
  { value: 'manual', label: 'Items manuales' },
];

const DIGITS = (v) => String(v || '').replace(/\D/g, '');

const clientPhone = (s) => {
  const raw = s.client_type === 'ruc'
    ? (Array.isArray(s.client?.telefonos) ? s.client.telefonos[0] : s.client?.telefonos)
    : s.client?.phone;
  const d = DIGITS(raw);
  if (!d) return null;
  if (d.length === 11 && d.startsWith('51')) return d;
  const short = d.startsWith('0') ? d.slice(1) : d;
  return short.length === 9 ? `51${short}` : null;
};

const buildWhatsAppMessage = (s, link) => {
  const client = s.client || {};
  const clientName =
    (client.names ? `${client.names} ${client.last_names || ''}`.trim() : client.razonsocial) || 'cliente';
  const advisorName = s.advisor?.name || COMPANY.seller.name;
  const advisorPhone = s.advisor?.whatsapp ? `+51 ${DIGITS(s.advisor.whatsapp)}` : `+51 ${COMPANY.phones[0]}`;
  return [
    `*${COMPANY.shortName}*`,
    `RUC ${COMPANY.ruc} · ${COMPANY.address}`,
    '',
    `Estimado(a) ${clientName}:`,
    '',
    `Le comparto su *${formatDocNumber(s.invoice_type, s.invoice_number)}* por el importe de *${fmtMoney(s.total)}*.`,
    ...(link
      ? ['Puede revisarla o descargarla desde el siguiente enlace:', link]
      : ['Adjunto: su documento en PDF. Puede revisarlo al descargar el archivo.']),
    '',
    `Para el pago, puede depositar a nuestra cuenta en *${COMPANY.bank.name}*:`,
    `*${COMPANY.bank.account}* (${COMPANY.bank.type})`,
    '',
    'Si realiza el depósito, sírvase enviarnos su constancia por este mismo canal para dejar su documento registrado como pagado.',
    '',
    'Quedamos atentos a cualquier consulta.',
    '',
    'Atentamente,',
    `*${advisorName}*`,
    `${COMPANY.seller.role}`,
    `${advisorPhone} · ${COMPANY.shortName}`,
  ].join('\n');
};

const WA_DOC_LABEL = { boleta: 'Boleta', factura: 'Factura', proforma: 'Proforma', cotizacion: 'Cotizacion' };
const waDocName = (s) =>
  `${WA_DOC_LABEL[s.invoice_type] || 'Documento'}-${String(s.invoice_number || '').padStart(7, '0')}`;

export default function Sales() {
  const toast = useToast();
  const { can } = useAuth();
  const { ask, ConfirmDialog } = useConfirm();
  const [rows, setRows] = useState(null);
  const [modal, setModal] = useState(false);
  const [view, setView] = useState(null);
  const [form, setForm] = useState(emptySale);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cats, setCats] = useState(null);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState(null);
  const [waSale, setWaSale] = useState(null);
  const [waBusyId, setWaBusyId] = useState(null);
  const [waConfigured, setWaConfigured] = useState(false);
  const docRef = useRef(null);
  const [specIdx, setSpecIdx] = useState(null);
  const [specForm, setSpecForm] = useState({ description: '', specifications: [], features: [] });
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [pagination, setPagination] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [quick, setQuick] = useState({});
  const [quickBusy, setQuickBusy] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);

  const load = () => {
    setFailed(false);
    const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    api.get(`/sales?${params}`).then((r) => { setRows(r.data.items); setPagination(r.data.pagination); }).catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, [page, dateFrom, dateTo]);

  const reloadList = useListReload(page, setPage, load, editingId);

  useEffect(() => {
    let alive = true;
    api.get('/whatsapp/config').then((r) => { if (alive) setWaConfigured(Boolean(r.data?.configured)); })
      .catch(() => { if (alive) setWaConfigured(false); });
    return () => { alive = false; };
  }, []);

  const isProformaLike = form.invoice_type === 'proforma' || form.invoice_type === 'cotizacion';

  const buildPayload = () => ({
    client_id: Number(form.client_id),
    client_type: form.client_type,
    advisor_id: form.advisor_id ? Number(form.advisor_id) : null,
    invoice_type: form.invoice_type,
    invoice_number: isProformaLike ? null : Number(form.invoice_number),
    with_igv: form.with_igv,
    subtotal: Number(subtotal.toFixed(2)),
    igv: Number(igv.toFixed(2)),
    total: Number(total.toFixed(2)),
    payment_status: form.payment_status,
    payment_description: form.payment_description || '',
    payment_date: form.payment_status === 'por_pagar' ? form.payment_date || null : null,
    amount_paid: form.payment_status === 'a_cuenta' ? Number(form.amount_paid) : null,
    amount_pending: form.payment_status === 'a_cuenta' ? Number((total - Number(form.amount_paid)).toFixed(2)) : null,
    pending_payment_date: form.payment_status === 'a_cuenta' ? form.pending_payment_date || null : null,
    items: form.items.map((i) => ({
      item_type: i.item_type,
      item_id: i.item_id ? Number(i.item_id) : null,
      manual_name: i.item_type === 'manual' ? i.manual_name || 'Item manual' : null,
      manual_description: i.manual_description || null,
      quantity: Number(i.quantity) || 1,
      unit_price: Number(i.unit_price) || 0,
      overrides: i.overrides || null,
    })),
  });

  const validate = () => {
    if (!form.client_id) return toast.warning('Selecciona un cliente');
    if (form.client_id === '__new__') return toast.warning('Completa los datos y crea el nuevo cliente para continuar');
    if (form.items.length === 0) return toast.warning('Agrega al menos un item');
    if (!isProformaLike && !form.invoice_number) return toast.warning('Indica el número de documento');
    if (form.payment_status === 'a_cuenta' && (!form.amount_paid || Number(form.amount_paid) <= 0))
      return toast.warning('Indica el monto abonado');
    return true;
  };

  const openPreview = async () => {
    if (!validate()) return;
    const payload = buildPayload();
    const client = (form.client_type === 'dni' ? cats?.clients : cats?.ruc || []).find((c) => String(c.id) === String(form.client_id));
    const advisor = (cats?.advisors || []).find((a) => String(a.id) === String(form.advisor_id));

    let displayNumber = form.invoice_number || null;
    if (isProformaLike && !displayNumber) {
      try {
        const r = await api.get('/sales/next-number', { params: { invoice_type: form.invoice_type } });
        displayNumber = r.data.next_number;
      } catch {
        const maxN = (rows || [])
          .filter((s) => s.invoice_type === form.invoice_type)
          .reduce((m, s) => Math.max(m, Number(s.invoice_number) || 0), 0);
        displayNumber = maxN + 1;
      }
    }

    const items = form.items.map((it) => {
      const found =
        it.item_type !== 'manual'
          ? (cats?.[it.item_type] || []).find((c) => String(c.id) === String(it.item_id))
          : null;
      const ov = it.overrides || null;
      return {
        name: found?.name || it.manual_name || 'Item',
        description: ov?.description != null ? ov.description : found?.description,
        specifications: ov?.specifications || found?.specifications || [],
        features: ov?.features || found?.features || [],
        is_manual: it.item_type === 'manual',
        manual_description: it.manual_description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        image_url: found?.image_url,
      };
    });

    setPreview({
      payload,
      sale: {
        invoice_type: form.invoice_type,
        invoice_number: displayNumber,
        client: {
          names: client?.names, last_names: client?.last_names, dni: client?.dni,
          address: client?.address, razonsocial: client?.razonsocial, ruc: client?.ruc,
          direccion: client?.direccion,
        },
        advisor_name: advisor?.name,
        subtotal, igv, total,
        items,
        created_at: new Date().toISOString(),
      },
    });
  };

  const confirmPreview = async () => {
    try {
      if (editingId) {
        await api.put(`/sales/${editingId}`, preview.payload);
        toast.success('Venta actualizada');
      } else {
        await api.post('/sales', preview.payload);
        toast.success(isProformaLike ? 'Proforma registrada correctamente' : 'Venta registrada correctamente');
      }
      setPreview(null);
      setModal(false);
      reloadList();
    } catch (e) {
      toast.error(errMsg(e));
      throw e;
    }
  };

  const { q, setQ, filtered } = useSearch(rows || [], [
    (r) => (r.invoice_number ? String(r.invoice_number) : ''),
    (r) => r.invoice_type,
    (r) => r.client?.names || r.client?.razonsocial || '',
    (r) => r.client?.dni || r.client?.ruc || '',
    (r) => r.advisor?.name || '',
    (r) => (r.total ? String(r.total) : ''),
  ]);

  const openAdd = async () => {
    setEditingId(null);
    setQuick({});
    setPhoneDraft('');
    setForm({ ...emptySale, invoice_type: 'boleta' });
    setModal(true);
  };
  const openEdit = (s) => {
    setEditingId(s.id);
    setQuick({});
    setPhoneDraft('');
    setForm({
      client_type: s.client_type || 'dni',
      client_id: s.client_id || '',
      advisor_id: s.advisor_id || '',
      invoice_type: s.invoice_type,
      invoice_number: s.invoice_number || '',
      with_igv: !!s.with_igv,
      payment_status: s.payment_status || 'pagado',
      payment_description: s.payment_description || '',
      payment_date: s.payment_date || '',
      amount_paid: s.amount_paid ?? '',
      pending_payment_date: s.pending_payment_date || '',
      items: (s.items || []).map((i) => ({
        item_type: i.item_type, item_id: i.item_id, manual_name: i.manual_name || '',
        manual_description: i.manual_description || '',
        quantity: i.quantity, unit_price: i.unit_price, selected: i.item_id ?? `${i.manual_name}`,
        overrides: i.overrides || null,
      })),
    });
    setModal(true);
  };

  useEffect(() => {
    if (cats) return;
    api.get('/catalogs')
      .then((r) => setCats(r.data))
      .catch(() => {});
  }, [modal, cats]);

  const subtotal = useMemo(
    () => form.items.reduce((acc, i) => acc + Number(i.quantity || 0) * Number(i.unit_price || 0), 0),
    [form.items]
  );
  const igv = form.with_igv ? subtotal * 0.18 : 0;
  const total = subtotal + igv;

  const setItemField = (idx, key, value) =>
    setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === idx ? { ...it, [key]: value } : it)) }));

  const addItem = (type) => {
    const blank = {
      item_type: type, item_id: '', selected: '', manual_name: '', manual_description: '',
      quantity: 1, unit_price: type === 'manual' ? '' : 0,
    };
    if (type === 'manual') {
      blank.selected = `manual_${Date.now()}`;
      blank.manual_name = '';
      blank.quantity = 1;
      blank.unit_price = '';
    }
    setForm((f) => ({ ...f, items: [...f.items, blank] }));
  };

  const pickItem = (idx, type, selected) => {
    const cat = cats?.[type] || [];
    const found = cat.find((c) => String(c.id) === String(selected));
    setItemField(idx, 'selected', selected);
    if (found) {
      setForm((f) => ({
        ...f,
        items: f.items.map((it, j) =>
          j === idx
            ? {
                ...it,
                item_type: type,
                item_id: found.id,
                manual_name: type === 'manual' ? it.manual_name : '',
                unit_price: found.price ?? it.unit_price,
                quantity: it.quantity || 1,
              }
            : it
        ),
      }));
    } else if (type === 'manual') {
      setItemField(idx, 'item_id', '');
    }
  };

  const removeItem = (idx) => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== idx) }));

  /* ---- Editor de características (specs/features/descripción del item) ---- */
  const openSpecs = (idx) => {
    const it = form.items[idx];
    const found =
      it.item_type !== 'manual'
        ? (cats?.[it.item_type] || []).find((c) => String(c.id) === String(it.item_id))
        : null;
    const ov = it.overrides || {};
    setSpecForm({
      description: ov.description != null ? ov.description : (found?.description || ''),
      specifications: (ov.specifications || found?.specifications || []).map((s) => ({ ...s })),
      features: [...(ov.features || found?.features || [])],
    });
    setSpecIdx(idx);
  };
  const closeSpecs = () => setSpecIdx(null);
  const saveSpecs = () => {
    setItemField(specIdx, 'overrides', {
      description: specForm.description || null,
      specifications: specForm.specifications.filter((s) => s.label || s.value),
      features: specForm.features.map((f) => f.trim()).filter(Boolean),
    });
    closeSpecs();
  };
  const setSpecField = (key, value) => setSpecForm((f) => ({ ...f, [key]: value }));
  const setSpecRow = (i, key, value) =>
    setSpecForm((f) => ({ ...f, specifications: f.specifications.map((s, j) => (j === i ? { ...s, [key]: value } : s)) }));
  const addSpec = () => setSpecForm((f) => ({ ...f, specifications: [...f.specifications, { label: '', value: '' }] }));
  const removeSpec = (i) => setSpecForm((f) => ({ ...f, specifications: f.specifications.filter((_, j) => j !== i) }));
  const setFeature = (i, value) => setSpecForm((f) => ({ ...f, features: f.features.map((x, j) => (j === i ? value : x)) }));
  const addFeature = () => setSpecForm((f) => ({ ...f, features: [...f.features, ''] }));
  const removeFeature = (i) => setSpecForm((f) => ({ ...f, features: f.features.filter((_, j) => j !== i) }));

  const paymentFields = (
    <div>
      <div className="field">
        <label>Estado de pago</label>
        <select className="select" value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>
          <option value="pagado">Pagado</option>
          <option value="por_pagar">Por pagar</option>
          <option value="a_cuenta">A cuenta</option>
        </select>
      </div>
      {form.payment_status === 'por_pagar' && (
        <div className="field">
          <label>Fecha compromiso de pago</label>
          <input className="input" type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
        </div>
      )}
      {form.payment_status === 'a_cuenta' && (
        <>
          <div className="grid-2">
            <div className="field">
              <label>Monto abonado</label>
              <input className="input" type="number" min="0" step="0.01" value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} />
            </div>
            <div className="field">
              <label>Monto pendiente</label>
              <input
                className="input"
                value={form.amount_paid === '' ? '' : fmtMoney(total - Number(form.amount_paid)).replace('S/ ', '')}
                disabled
                style={{ background: 'var(--g-softer)' }}
              />
            </div>
          </div>
          <div className="field">
            <label>Fecha de pago pendiente</label>
            <input className="input" type="date" value={form.pending_payment_date} onChange={(e) => setForm({ ...form, pending_payment_date: e.target.value })} />
          </div>
        </>
      )}
      <div className="field">
        <label>Nota de pago</label>
        <textarea className="textarea" placeholder="Comentarios sobre el pago" value={form.payment_description} onChange={(e) => setForm({ ...form, payment_description: e.target.value })} />
      </div>
    </div>
  );

  const save = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      const payload = buildPayload();
      if (editingId) {
        await api.put(`/sales/${editingId}`, payload);
        toast.success('Venta actualizada');
      } else {
        await api.post('/sales', payload);
        toast.success('Venta registrada correctamente');
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
      title: 'Anular venta',
      message: `¿Deseas anular la venta ${s.invoice_type.toUpperCase()}-${String(s.invoice_number || '').padStart(7, '0')}? Se ocultará del sistema.`,
      confirmText: 'Anular venta',
    });
    if (!ok) return;
    try {
      await api.delete(`/sales/${s.id}`);
      toast.success('Venta anulada');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const markPaid = async (s) => {
    const doc = `${s.invoice_type.toUpperCase()}-${String(s.invoice_number || '').padStart(7, '0')}`;
    const ok = await ask({
      title: 'Marcar como pagado',
      message: `¿Confirmas que ${doc} ya fue pagada? Se registrará la fecha de pago de hoy y el monto pendiente quedará en S/ 0.00.`,
      confirmText: 'Sí, marcar pagada',
      confirmVariant: 'primary',
    });
    if (!ok) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    try {
      await api.patch(`/sales/${s.id}/payment`, { payment_status: 'pagado', payment_date: today });
      toast.success(`${doc} marcada como pagada`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const sendWhatsApp = async (s) => {
    const phone = clientPhone(s);
    if (!phone) return toast.warning('El cliente no tiene teléfono/WhatsApp registrado');

    if (!waConfigured) {
      try {
        const r = await api.post(`/sales/${s.id}/share-token`);
        const link = `${window.location.origin}/doc/${s.id}/${r.data.share_token}`;
        const msg = buildWhatsAppMessage(s, link);
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
      } catch (e) {
        toast.error(errMsg(e));
      }
      return;
    }

    const fileName = `${waDocName(s)}.pdf`;

    setWaSale({ ...s, advisor_name: s.advisor_name || s.advisor?.name });
    setWaBusyId(s.id);
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 60));
      const rootEl = docRef.current;
      if (!rootEl) throw new Error('No se pudo preparar el documento PDF');
      const pdfBlob = await buildDocumentPdfBlob(
        rootEl.querySelector('.proforma-main-page'),
        rootEl.querySelector('.proforma-photos')
      );
      const url = await uploadFile(new File([pdfBlob], fileName, { type: 'application/pdf' }));
      const msg = buildWhatsAppMessage(s, null);
      await api.post('/whatsapp/send-media', { phone, media_url: url, filename: fileName, caption: msg });
      toast.success('Documento enviado por WhatsApp con el PDF adjunto');
    } catch (e) {
      const err = errMsg(e);
      try {
        const r = await api.post(`/sales/${s.id}/share-token`);
        const link = `${window.location.origin}/doc/${s.id}/${r.data.share_token}`;
        const msg = buildWhatsAppMessage(s, link);
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
        toast.info(`No se pudo adjuntar el PDF (${err}); se abrió WhatsApp con el enlace del documento`);
      } catch (e2) {
        toast.error(errMsg(e2));
      }
    } finally {
      setWaBusyId(null);
      setWaSale(null);
    }
  };

  if (!rows) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar las ventas" /> : <Loader text="Cargando ventas..." />;

  const clientList = form.client_type === 'dni' ? cats?.clients || [] : cats?.ruc || [];

  const selClient =
    form.client_id && form.client_id !== '__new__'
      ? clientList.find((c) => String(c.id) === String(form.client_id))
      : null;

  const clientPhoneValue = (c) =>
    form.client_type === 'ruc'
      ? (Array.isArray(c?.telefonos) ? c.telefonos[0] : c?.telefonos)
      : c?.phone;

  const saveQuickClient = async () => {
    if (form.client_type === 'dni') {
      const dni = String(quick.dni || '').replace(/\D/g, '');
      if (!/^\d{8}$/.test(dni)) return toast.warning('El DNI debe tener 8 dígitos');
      if (!String(quick.names || '').trim() || !String(quick.last_names || '').trim())
        return toast.warning('Nombres y apellidos son obligatorios');
      const dup = (cats?.clients || []).find((c) => c.dni === dni);
      if (dup) {
        toast.warning('El cliente ya existe — se seleccionó del listado');
        return setForm((f) => ({ ...f, client_id: dup.id }));
      }
      setQuickBusy(true);
      try {
        const r = await api.post('/clients', {
          dni,
          names: String(quick.names).trim(),
          last_names: String(quick.last_names).trim(),
          address: String(quick.address || '').trim() || null,
          phone: String(quick.phone || '').replace(/\D/g, '') || null,
        });
        setCats((c) => ({ ...c, clients: [...(c?.clients || []), r.data] }));
        setForm((f) => ({ ...f, client_id: r.data.id }));
        toast.success('Cliente creado y seleccionado');
      } catch (e) {
        toast.error(errMsg(e));
      } finally {
        setQuickBusy(false);
      }
    } else {
      const ruc = String(quick.ruc || '').replace(/\D/g, '');
      if (!/^\d{11}$/.test(ruc)) return toast.warning('El RUC debe tener 11 dígitos');
      if (!String(quick.razonsocial || '').trim()) return toast.warning('La razón social es obligatoria');
      const dup = (cats?.ruc || []).find((c) => c.ruc === ruc);
      if (dup) {
        toast.warning('La empresa ya existe — se seleccionó del listado');
        return setForm((f) => ({ ...f, client_id: dup.id }));
      }
      setQuickBusy(true);
      try {
        const phone = String(quick.phone || '').replace(/\D/g, '');
        const r = await api.post('/clients-ruc', {
          ruc,
          razonsocial: String(quick.razonsocial).trim(),
          telefonos: phone ? [phone] : [],
        });
        setCats((c) => ({ ...c, ruc: [...(c?.ruc || []), r.data] }));
        setForm((f) => ({ ...f, client_id: r.data.id }));
        toast.success('Empresa creada y seleccionada');
      } catch (e) {
        toast.error(errMsg(e));
      } finally {
        setQuickBusy(false);
      }
    }
  };

  const saveClientPhone = async () => {
    const phone = String(phoneDraft || '').replace(/\D/g, '');
    if (!phone) return toast.warning('Escribe un número de teléfono');
    if (phone.length < 7) return toast.warning('El número es muy corto');
    if (!selClient) return;
    setPhoneBusy(true);
    try {
      if (form.client_type === 'ruc') {
        await api.put(`/clients-ruc/${selClient.id}`, { telefonos: [phone] });
      } else {
        await api.put(`/clients/${selClient.id}`, { phone });
      }
      const updated = { ...selClient, ...(form.client_type === 'ruc' ? { telefonos: [phone] } : { phone }) };
      const listKey = form.client_type === 'ruc' ? 'ruc' : 'clients';
      setCats((c) => ({
        ...c,
        [listKey]: (c?.[listKey] || []).map((x) => (x.id === selClient.id ? updated : x)),
      }));
      setRows((rs) =>
        (rs || []).map((s) =>
          s.client_id === selClient.id
            ? { ...s, client: { ...s.client, ...(form.client_type === 'ruc' ? { telefonos: [phone] } : { phone }) } }
            : s
        )
      );
      setPhoneDraft('');
      toast.success('Teléfono guardado');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setPhoneBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ventas</h1>
          <div className="sub">Boletas, facturas, proformas y cotizaciones</div>
        </div>
        {can('SALES_CREATE') && <button className="btn btn-primary btn-lg" onClick={openAdd}><Icon name="plus" size={17} /> Nueva Venta</button>}
      </div>

      <div className="card">
        <Toolbar search={q} onSearch={setQ} placeholder="Buscar por documento, cliente o monto...">
          <div className="date-range">
            <input
              type="date"
              className="input"
              value={dateFrom}
              max={dateTo || ''}
              aria-label="Desde"
              title="Desde"
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            />
            <span className="date-sep">hasta</span>
            <input
              type="date"
              className="input"
              value={dateTo}
              min={dateFrom || ''}
              aria-label="Hasta"
              title="Hasta"
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            />
            {(dateFrom || dateTo) && (
              <button type="button" className="btn-icon" title="Limpiar fechas" onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}>
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
          <span className="pill-count">{filtered.length} ventas</span>
        </Toolbar>
        <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Cliente</th>
                <th>Asesor</th>
                <th>Total</th>
                <th>Pago</th>
                <th>Fecha</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td data-label="Documento">
                    <InvoiceBadge type={s.invoice_type} number={s.invoice_number} />
                    <div style={{ marginTop: 3 }}><DocTypeBadge type={s.invoice_type} /></div>
                  </td>
                  <td data-label="Cliente" style={{ maxWidth: 240 }}>
                    <div className="cell-title">{s.client ? (s.client.names ? `${s.client.names} ${s.client.last_names || ''}` : s.client.razonsocial) : '—'}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      {s.client ? (s.client.dni ? `DNI ${s.client.dni}` : s.client.ruc ? `RUC ${s.client.ruc}` : '') : '—'}
                    </div>
                    {clientPhone(s) && (
                      <div className="text-muted" style={{ fontSize: 12, color: 'var(--g-dark)' }}>
                        {s.client?.phone || (Array.isArray(s.client?.telefonos) ? s.client.telefonos[0] : s.client?.telefonos)}
                      </div>
                    )}
                  </td>
                  <td data-label="Asesor" className="text-muted">{s.advisor?.name || '—'}</td>
                  <td data-label="Total" className="money"><b>{fmtMoney(s.total)}</b></td>
                  <td data-label="Pago">
                    <StatusBadge value={s.payment_status} />
                    {s.payment_status === 'pagado' && s.payment_date ? (
                      <div className="text-muted" style={{ fontSize: 11.5, marginTop: 3, whiteSpace: 'nowrap' }}>
                        Cancelado: {fmtDate(s.payment_date)}
                      </div>
                    ) : s.payment_status === 'a_cuenta' && Number(s.amount_pending) > 0 ? (
                      <div className="text-muted" style={{ fontSize: 11.5, marginTop: 3, whiteSpace: 'nowrap' }}>
                        Saldo: {fmtMoney(s.amount_pending)}
                      </div>
                    ) : null}
                  </td>
                  <td data-label="Fecha" className="text-muted">{fmtDateTime(s.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-icon" onClick={() => setView(s)} title="Ver detalle"><Icon name="visible" size={14} /></button>
                      <button className="btn-icon" onClick={() => setPreview({ sale: s, payload: null })} title="Imprimir / PDF"><Icon name="print" size={14} /></button>
                      {clientPhone(s) && (
                        <button className="btn-icon wa" onClick={() => sendWhatsApp(s)} disabled={waBusyId !== null} title="Enviar por WhatsApp (PDF adjunto)">
                          {waBusyId === s.id ? <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> : <Icon name="whatsapp" size={14} />}
                        </button>
                      )}
                      {s.payment_status !== 'pagado' && can('SALES_UPDATE') && (
                        <button className="btn-icon pay" onClick={() => markPaid(s)} title="Marcar como pagado"><Icon name="checkmark" size={14} /></button>
                      )}
                      {can('SALES_UPDATE') && <button className="btn-icon" onClick={() => openEdit(s)} title="Editar"><Icon name="edit" size={14} /></button>}
                      {can('SALES_DELETE') && <button className="btn-icon danger" onClick={() => remove(s)} title="Anular"><Icon name="trash" size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title={q ? 'Sin coincidencias' : 'No hay ventas'} hint="Registra tu primera venta" />}
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

      {/* Formulario de venta */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editingId ? 'Editar venta' : 'Nueva venta'}
        icon={<Icon name="shopping-cart" size={18} />}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setModal(false)}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-yellow" onClick={openPreview} disabled={busy} style={{ justifyContent: 'center', minWidth: 190 }}>
              <Icon name="visible" size={16} /> Vista previa <b className="money" style={{ marginLeft: 4 }}>({fmtMoney(total)})</b>
            </button>
            <button className="btn btn-primary" onClick={save} disabled={busy} style={{ justifyContent: 'center', minWidth: 190 }}>
              {busy ? <span className="spinner" /> : <Icon name="save" size={15} />} Guardar venta {!busy && <b className="money" style={{ marginLeft: 4 }}>({fmtMoney(total)})</b>}
            </button>
          </>
        }
      >
        <div className="grid-3">
          <div className="field">
            <label><Icon name="user-male" size={14} /> Tipo de cliente</label>
            <select className="select" value={form.client_type} onChange={(e) => { setForm({ ...form, client_type: e.target.value, client_id: '' }); setQuick({}); setPhoneDraft(''); }}>
              <option value="dni">Persona (DNI)</option>
              <option value="ruc">Empresa (RUC)</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label><Icon name="user-male-circle" size={14} /> Cliente <span className="req">*</span></label>
            <select className="select" value={form.client_id} onChange={(e) => { setForm({ ...form, client_id: e.target.value }); setQuick({}); setPhoneDraft(''); }}>
              <option value="">— Seleccionar cliente —</option>
              <option value="__new__">＋ Nuevo cliente…</option>
              {clientList.map((c) => (
                <option key={c.id} value={c.id}>
                  {form.client_type === 'dni'
                    ? `${c.names} ${c.last_names || ''} — DNI ${c.dni}`
                    : `${c.razonsocial} — RUC ${c.ruc}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {form.client_id === '__new__' ? (
          <div className="quick-client">
            <div className="quick-client-title">
              <Icon name="plus" size={13} /> Crear {form.client_type === 'dni' ? 'cliente (DNI)' : 'empresa (RUC)'}
            </div>
            <div className="grid-2">
              {form.client_type === 'dni' ? (
                <>
                  <div className="field"><label>DNI <span className="req">*</span></label><input className="input" maxLength={8} placeholder="8 dígitos" value={quick.dni || ''} onChange={(e) => setQuick({ ...quick, dni: e.target.value.replace(/\D/g, '') })} /></div>
                  <div className="field"><label>Nombres <span className="req">*</span></label><input className="input" value={quick.names || ''} onChange={(e) => setQuick({ ...quick, names: e.target.value })} /></div>
                  <div className="field"><label>Apellidos <span className="req">*</span></label><input className="input" value={quick.last_names || ''} onChange={(e) => setQuick({ ...quick, last_names: e.target.value })} /></div>
                  <div className="field"><label>Teléfono / WhatsApp</label><input className="input" maxLength={9} placeholder="Opcional" value={quick.phone || ''} onChange={(e) => setQuick({ ...quick, phone: e.target.value.replace(/\D/g, '') })} /></div>
                  <div className="field" style={{ gridColumn: 'span 2' }}><label>Dirección</label><input className="input" value={quick.address || ''} onChange={(e) => setQuick({ ...quick, address: e.target.value })} /></div>
                </>
              ) : (
                <>
                  <div className="field"><label>RUC <span className="req">*</span></label><input className="input" maxLength={11} placeholder="11 dígitos" value={quick.ruc || ''} onChange={(e) => setQuick({ ...quick, ruc: e.target.value.replace(/\D/g, '') })} /></div>
                  <div className="field"><label>Razón social <span className="req">*</span></label><input className="input" value={quick.razonsocial || ''} onChange={(e) => setQuick({ ...quick, razonsocial: e.target.value })} /></div>
                  <div className="field"><label>Teléfono / WhatsApp</label><input className="input" maxLength={9} placeholder="Opcional" value={quick.phone || ''} onChange={(e) => setQuick({ ...quick, phone: e.target.value.replace(/\D/g, '') })} /></div>
                </>
              )}
            </div>
            <div className="flex" style={{ gap: 8, marginTop: 4 }}>
              <button className="btn btn-primary" onClick={saveQuickClient} disabled={quickBusy}>
                {quickBusy ? <span className="spinner" /> : <Icon name="plus" size={15} />} Crear y seleccionar
              </button>
              <button className="btn btn-ghost" onClick={() => setForm((f) => ({ ...f, client_id: '' }))}><Icon name="x" size={15} /> Cancelar</button>
            </div>
          </div>
        ) : selClient && !clientPhoneValue(selClient) ? (
          <div className="quick-phone">
            <Icon name="whatsapp" size={15} />
            <span>
              <b>{selClient.names ? `${selClient.names} ${selClient.last_names || ''}` : selClient.razonsocial}</b>{' '}
              no tiene teléfono registrado — agrégalo para poder enviarle documentos por WhatsApp:
            </span>
            <input
              className="input"
              maxLength={9}
              placeholder="Ej. 987654321"
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveClientPhone(); } }}
            />
            <button className="btn btn-yellow" onClick={saveClientPhone} disabled={phoneBusy}>
              {phoneBusy ? <span className="spinner" /> : <Icon name="save" size={14} />} Guardar
            </button>
          </div>
        ) : null}

        <div className="grid-3">
          <div className="field">
            <label><Icon name="user-male" size={14} /> Asesor</label>
            <select className="select" value={form.advisor_id} onChange={(e) => setForm({ ...form, advisor_id: e.target.value })}>
              <option value="">— Sin asesor —</option>
              {(cats?.advisors || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label><Icon name="add-file" size={14} /> Tipo de documento</label>
            <select className="select" value={form.invoice_type} onChange={(e) => setForm({ ...form, invoice_type: e.target.value })}>
              <option value="boleta">Boleta</option>
              <option value="factura">Factura</option>
              <option value="proforma">Proforma</option>
              <option value="cotizacion">Cotización</option>
            </select>
          </div>
          <div className="field">
            <label>N° documento</label>
            {form.invoice_type === 'proforma' || form.invoice_type === 'cotizacion' ? (
              <input className="input" value="Auto" disabled style={{ background: 'var(--g-softer)', fontWeight: 700, color: 'var(--g-dark)' }} />
            ) : (
              <input className="input" type="number" min="1" placeholder="Ej. 1001" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} />
            )}
          </div>
        </div>

        <label className="check" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={form.with_igv} onChange={(e) => setForm({ ...form, with_igv: e.target.checked })} />
          Con IGV (18%)
        </label>

        <div className="field">
          <label>Items de la venta</label>
          <div className="sale-items">
            <div className="sale-item-row header">
              <span>Descripción</span><span>Cant.</span><span>P. Unit.</span><span>Subtotal</span><span />
            </div>
            {form.items.length === 0 && (
              <div className="sale-item-row" style={{ justifyItems: 'center', color: 'var(--faint)', fontSize: 12.5, padding: '18px' }}>
                Sin items — agrega uno con los botones de abajo
              </div>
            )}
            {form.items.map((it, idx) => {
              const isManual = it.item_type === 'manual';
              return (
                <div className="sale-item-row" key={idx}>
                  {isManual ? (
                    <div>
                      <input className="input" placeholder="Nombre del item" value={it.manual_name} onChange={(e) => setItemField(idx, 'manual_name', e.target.value)} />
                    </div>
                  ) : (
                    <select
                      className="select"
                      value={it.selected}
                      onChange={(e) => pickItem(idx, it.item_type, e.target.value)}
                    >
                      <option value="">— Seleccionar {it.item_type === 'machine' ? 'producto' : it.item_type === 'repuesto' ? 'repuesto' : 'servicio'} —</option>
                      {(cats?.[it.item_type] || []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} — {fmtMoney(c.price)}
                        </option>
                      ))}
                    </select>
                  )}
                  <input className="input" type="number" min="0.01" step="0.01" value={it.quantity} onChange={(e) => setItemField(idx, 'quantity', e.target.value)} />
                  <input className="input" type="number" min="0" step="0.01" value={it.unit_price} onChange={(e) => setItemField(idx, 'unit_price', e.target.value)} />
                  <b className="money" style={{ fontSize: 13 }}>{fmtMoney(Number(it.quantity || 0) * Number(it.unit_price || 0))}</b>
                  <div className="flex" style={{ gap: 4 }}>
                    <button className={`btn-icon ${it.overrides ? 'active' : ''}`} title="Editar características" onClick={() => openSpecs(idx)}><Icon name="settings" size={14} /></button>
                    <button className="btn-icon danger" onClick={() => removeItem(idx)}><Icon name="trash" size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
            {ITEM_TYPES.map((t) => (
              <button key={t.value} className="btn btn-outline btn-sm" onClick={() => addItem(t.value)}>
                <Icon name="plus" size={13} /> {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid-2">
          <div className="sale-summary">
            <div className="line"><span className="text-muted">Subtotal</span><span className="money">{fmtMoney(subtotal)}</span></div>
            <div className="line"><span className="text-muted">IGV {form.with_igv ? '(18%)' : '(0%)'}</span><span className="money">{fmtMoney(igv)}</span></div>
            <div className="line total"><span>Total</span><span className="money">{fmtMoney(total)}</span></div>
          </div>
          {paymentFields}
        </div>
      </Modal>

      {/* Detalle de venta */}
      <Modal
        open={!!view}
        onClose={() => setView(null)}
        title="Detalle de la venta"
        icon={<Icon name="cash" size={18} />}
        size="lg"
        footer={
          <button className="btn btn-primary" onClick={() => setView(null)}>Entendido</button>
        }
      >
        {view && (
          <>
            <div className="flex-between" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
              <div>
                <div>
                  <InvoiceBadge type={view.invoice_type} number={view.invoice_number} />
                  {' '}<DocTypeBadge type={view.invoice_type} />
                </div>
                <div className="text-muted" style={{ fontSize: 12.5, marginTop: 4 }}>Registrado: {fmtDateTime(view.created_at)}</div>
                {view.payment_status === 'pagado' && view.payment_date && (
                  <div className="text-muted" style={{ fontSize: 12.5, marginTop: 3, color: 'var(--g-dark)', fontWeight: 600 }}>
                    <Icon name="checkmark" size={13} style={{ color: 'var(--g-dark)' }} /> Pagado: {fmtDate(view.payment_date)}
                  </div>
                )}
              </div>
              <StatusBadge value={view.payment_status} />
            </div>

            <div className="grid-3" style={{ marginBottom: 14 }}>
              <div>
                <div className="text-muted" style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase' }}>Cliente</div>
                <b>{view.client ? (view.client.names ? `${view.client.names} ${view.client.last_names || ''}` : view.client.razonsocial) : '—'}</b>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {view.client ? (view.client.dni ? `DNI ${view.client.dni}` : view.client.ruc ? `RUC ${view.client.ruc}` : '') : ''}
                </div>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase' }}>Asesor</div>
                <b>{view.advisor?.name || '—'}</b>
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase' }}>IGV</div>
                <b>{view.with_igv ? 'Con IGV (18%)' : 'Sin IGV'}</b>
              </div>
            </div>

            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table className="data">
                <thead>
                  <tr><th>Item</th><th>Tipo</th><th>Cant.</th><th>P. Unit.</th><th>Subtotal</th></tr>
                </thead>
                <tbody>
                  {(view.items || []).map((i, idx) => (
                    <tr key={idx}>
                      <td data-label="Item" className="cell-title">{i.name || i.manual_name || 'Item'}
                        {i.manual_description && <div className="text-muted" style={{ fontSize: 12 }}>{i.manual_description}</div>}
                      </td>
                      <td data-label="Tipo">
                        <span className="chip">
                          {{ machine: 'Producto', repuesto: 'Repuesto', service: 'Servicio', manual: 'Manual' }[i.item_type] || i.item_type}
                        </span>
                      </td>
                      <td data-label="Cant.">{i.quantity}</td>
                      <td data-label="P. Unit." className="money">{fmtMoney(i.unit_price)}</td>
                      <td data-label="Subtotal" className="money"><b>{fmtMoney(i.quantity * i.unit_price)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sale-summary">
              <div className="line"><span className="text-muted">Subtotal</span><span className="money">{fmtMoney(view.subtotal)}</span></div>
              <div className="line"><span className="text-muted">IGV</span><span className="money">{fmtMoney(view.igv)}</span></div>
              <div className="line total"><span>Total</span><span className="money">{fmtMoney(view.total)}</span></div>
              {view.amount_paid != null && (
                <div className="line"><span className="text-muted">Abonado</span><span className="money">{fmtMoney(view.amount_paid)}</span></div>
              )}
              {view.amount_pending != null && (
                <div className="line"><span className="text-muted">Pendiente</span><span className="money text-danger">{fmtMoney(view.amount_pending)}</span></div>
              )}
            </div>
            {view.payment_description && (
              <div style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)', background: 'var(--g-softer)', padding: '10px 14px', borderRadius: 10 }}>
                <b>Nota de pago:</b> {view.payment_description}
              </div>
            )}
          </>
        )}
      </Modal>

      {ConfirmDialog}

      {/* Editor de características del item */}
      <Modal
        open={specIdx !== null}
        onClose={closeSpecs}
        title="Editar características del item"
        icon={<Icon name="settings" size={18} />}
        size="lg"
        footer={
          <>
            <button className="btn btn-ghost" onClick={closeSpecs}><Icon name="x" size={15} /> Cancelar</button>
            <button className="btn btn-primary" onClick={saveSpecs}><Icon name="save" size={15} /> Guardar cambios</button>
          </>
        }
      >
        <div className="field">
          <label>Descripción</label>
          <textarea className="textarea" rows={3} value={specForm.description} onChange={(e) => setSpecField('description', e.target.value)} />
        </div>
        <div className="field">
          <label>Especificaciones</label>
          {specForm.specifications.map((s, i) => (
            <div className="flex" style={{ marginBottom: 6 }} key={i}>
              <input className="input" placeholder="Label (ej. Potencia)" value={s.label} onChange={(e) => setSpecRow(i, 'label', e.target.value)} />
              <input className="input" placeholder="Valor (ej. 70 HP)" value={s.value} onChange={(e) => setSpecRow(i, 'value', e.target.value)} />
              <button className="btn-icon danger" onClick={() => removeSpec(i)}><Icon name="trash" size={14} /></button>
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={addSpec}><Icon name="plus" size={13} /> Agregar especificación</button>
        </div>
        <div className="field">
          <label>Características</label>
          {specForm.features.map((f, i) => (
            <div className="flex" style={{ marginBottom: 6 }} key={i}>
              <input className="input" value={f} onChange={(e) => setFeature(i, e.target.value)} />
              <button className="btn-icon danger" onClick={() => removeFeature(i)}><Icon name="trash" size={14} /></button>
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={addFeature}><Icon name="plus" size={13} /> Agregar característica</button>
        </div>
      </Modal>

      <ProformaModal
        open={!!preview}
        onClose={() => setPreview(null)}
        sale={preview?.sale}
        onConfirm={preview?.payload ? confirmPreview : null}
      />

      {waSale && (
        <div
          style={{ position: 'fixed', top: 0, left: -12000, width: 794, zIndex: -1, pointerEvents: 'none', background: '#fff' }}
          aria-hidden="true"
        >
          <ProformaDocument ref={docRef} sale={waSale} />
        </div>
      )}
    </>
  );
}