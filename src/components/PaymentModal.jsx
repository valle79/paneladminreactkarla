import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { api, errMsg } from '../api';
import { useToast } from './Toast';
import { Modal, useConfirm } from './Modal';
import { Badge, fmtDate, EmptyState, Loader } from './ui';

export const CURR_SYM = { PEN: 'S/', USD: 'US$', EUR: '€', CNY: 'CN¥' };
export const CURRENCIES = ['PEN', 'USD', 'EUR', 'CNY'];
export const MEDIOS_PAGO = [
  'TRANSFERENCIA',
  'DEPOSITO',
  'EFECTIVO',
  'TARJETA',
  'OTRO',
  'TRANSFERENCIA INTERNACIONAL',
  'SWIFT',
  'PAYPAL',
];

export const fmtAmount = (v, cur = 'PEN') =>
  `${CURR_SYM[cur] || cur} ${Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ESTADO_PAGO_MAP = {
  PENDIENTE: ['red', 'Pendiente'],
  PAGADA_PARCIAL: ['yellow', 'Pagada parcial'],
  PAGADA: ['green', 'Pagada'],
  VENCIDA: ['red', 'Vencida'],
  ANULADA: ['gray', 'Anulada'],
};

const todayISO = () => new Date().toISOString().slice(0, 10);

export function PaymentModal({ open, onClose, purchase, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    fecha_pago: todayISO(),
    moneda: '',
    monto: '',
    tipo_cambio: '1',
    medio_pago: 'EFECTIVO',
    numero_operacion: '',
    banco: '',
    observaciones: '',
    allow_overpayment: false,
  });

  useEffect(() => {
    if (!open || !purchase) return;
    setForm((f) => ({
      ...f,
      fecha_pago: todayISO(),
      moneda: purchase.moneda || 'PEN',
      monto: purchase.saldo != null ? String(purchase.saldo) : '',
      tipo_cambio: String(purchase.tipo_cambio || 1),
      medio_pago: 'EFECTIVO',
      numero_operacion: '',
      banco: '',
      observaciones: '',
      allow_overpayment: false,
    }));
  }, [open, purchase]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const monedaCompra = purchase?.moneda || 'PEN';
  const tcCompra = Number(purchase?.tipo_cambio || 1);
  const saldo = Number(purchase?.saldo || 0);
  const monto = Number(form.monto || 0);
  const tc = Number(form.tipo_cambio || 0);
  const equivCompra = monto * (tc / tcCompra);
  const over = monto > saldo;

  const save = async () => {
    if (!purchase) return;
    if (!(monto > 0)) return toast.warning('Ingresa un monto mayor a 0');
    if (!(tc > 0)) return toast.warning('El tipo de cambio debe ser mayor a 0');
    if (over && !form.allow_overpayment)
      return toast.warning('El pago supera el saldo. Marca "permitir sobrepago (anticipo)" para continuar.');
    setBusy(true);
    try {
      const payload = {
        purchase_id: purchase.id,
        supplier_id: purchase.supplier_id || purchase.proveedor_id || purchase.supplier?.id,
        fecha_pago: form.fecha_pago || todayISO(),
        moneda: form.moneda,
        monto,
        tipo_cambio: tc,
        medio_pago: form.medio_pago,
        numero_operacion: form.numero_operacion.trim() || null,
        banco: form.banco.trim() || null,
        observaciones: form.observaciones.trim() || null,
        allow_overpayment: over ? form.allow_overpayment : false,
      };
      await api.post('/supplier-payments', payload);
      toast.success('Pago registrado correctamente');
      onClose();
      onDone?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar pago a proveedor"
      icon={<Icon name="money" size={18} />}
      size="sm"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}><Icon name="x" size={15} /> Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={busy} style={{ minWidth: 180 }}>
            {busy ? <span className="spinner" /> : <Icon name="checkmark" size={15} />} Registrar pago
          </button>
        </>
      }
    >
      {purchase && (
        <>
          <div style={{ background: 'var(--g-softer)', border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, color: 'var(--g-forest)' }}>{purchase.codigo_compra}</div>
            <div className="text-muted" style={{ fontSize: 12.5 }}>{purchase.supplier?.razon_social || 'Proveedor'}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12.5 }}>
              <span className="text-muted">Total</span>
              <b className="money">{fmtAmount(purchase.total, monedaCompra)}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span className="text-muted">Saldo</span>
              <b className="money" style={{ color: saldo > 0 ? 'var(--danger)' : 'var(--g-primary)' }}>{fmtAmount(saldo, monedaCompra)}</b>
            </div>
            {purchase.fecha_vencimiento && (
              <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                Vence: <b>{fmtDate(purchase.fecha_vencimiento)}</b>
              </div>
            )}
          </div>

          <div className="grid-3">
            <div className="field">
              <label>Fecha de pago</label>
              <input className="input" type="date" value={form.fecha_pago} onChange={(e) => setField('fecha_pago', e.target.value)} />
            </div>
            <div className="field">
              <label>Moneda <span className="req">*</span></label>
              <select className="input" value={form.moneda} onChange={(e) => setField('moneda', e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Tipo de cambio <span className="req">*</span></label>
              <input className="input" inputMode="decimal" value={form.tipo_cambio} onChange={(e) => setField('tipo_cambio', e.target.value)} />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Monto <span className="req">*</span></label>
              <input className="input" inputMode="decimal" placeholder="0.00" value={form.monto} onChange={(e) => setField('monto', e.target.value)} />
            </div>
            <div className="field">
              <label>Medio de pago <span className="req">*</span></label>
              <select className="input" value={form.medio_pago} onChange={(e) => setField('medio_pago', e.target.value)}>
                {MEDIOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {form.moneda !== monedaCompra && monto > 0 && (
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Equivale a <b className="money">{fmtAmount(equivCompra, monedaCompra)}</b> en moneda de la compra ({form.moneda} → {monedaCompra}).
            </div>
          )}

          <div className="grid-2">
            <div className="field">
              <label>N° de operación</label>
              <input className="input" value={form.numero_operacion} onChange={(e) => setField('numero_operacion', e.target.value)} placeholder="Opcional" />
            </div>
            <div className="field">
              <label>Banco</label>
              <input className="input" value={form.banco} onChange={(e) => setField('banco', e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <div className="field">
            <label>Observaciones</label>
            <textarea className="input" rows={2} value={form.observaciones} onChange={(e) => setField('observaciones', e.target.value)} />
          </div>

          {over && (
            <label className="flex" style={{ gap: 8, fontSize: 13, alignItems: 'center', marginTop: 8 }}>
              <input type="checkbox" checked={form.allow_overpayment} onChange={(e) => setField('allow_overpayment', e.target.checked)} />
              Permitir sobrepago (anticipo) — el pago supera el saldo de la compra
            </label>
          )}
        </>
      )}
    </Modal>
  );
}

export function PurchasePicker({ open, onClose, onSelect }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const load = () => {
    setRows(null);
    api.get(`/purchases?page=1&limit=100`)
      .then((r) => setRows(r.data.items))
      .catch((e) => toast.error(errMsg(e)));
  };
  useEffect(() => { if (open) load(); }, [open]);

  const pendientes = useMemo(() => (rows || []).filter((r) =>
    r.saldo > 0 && !['BORRADOR', 'CANCELADA'].includes(r.estado)
  ), [rows]);

  const term = q.trim().toLowerCase();
  const filtered = term
    ? pendientes.filter((r) =>
        String(r.codigo_compra || '').toLowerCase().includes(term) ||
        String(r.supplier?.razon_social || '').toLowerCase().includes(term)
      )
    : pendientes;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Seleccionar compra"
      icon={<Icon name="search" size={18} />}
      size="lg"
    >
      <div className="search" style={{ marginBottom: 12 }}>
        <Icon name="search" size={16} />
        <input className="input" placeholder="Buscar por código o proveedor..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!rows ? (
        <Loader text="Cargando compras con saldo pendiente..." />
      ) : !filtered.length ? (
        <EmptyState title="Sin compras por pagar" hint="No hay compras con saldo pendiente" />
      ) : (
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="data" style={{ fontSize: 12.5 }}>
            <thead>
              <tr>
                <th>Código</th>
                <th>Proveedor</th>
                <th>Fecha</th>
                <th>Total</th>
                <th>Saldo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td><b style={{ color: 'var(--g-forest)' }}>{r.codigo_compra}</b></td>
                  <td style={{ maxWidth: 220 }}>{r.supplier?.razon_social || '—'}</td>
                  <td className="text-muted">{fmtDate(r.fecha_compra)}</td>
                  <td className="money">{fmtAmount(r.total, r.moneda)}</td>
                  <td className="money" style={{ color: 'var(--danger)', fontWeight: 700 }}>{fmtAmount(r.saldo, r.moneda)}</td>
                  <td>
                    {(() => { const [k, l] = ESTADO_PAGO_MAP[r.estado_pago] || ['gray', r.estado_pago]; return <Badge kind={k}>{l}</Badge>; })()}
                  </td>
                  <td>
                    <button className="btn btn-primary btn-sm" onClick={() => { onClose(); onSelect(r); }}>
                      <Icon name="money" size={14} /> Pagar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export function PaymentsList({ open, onClose, purchaseId }) {
  const toast = useToast();
  const { ask, ConfirmDialog } = useConfirm();
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setRows(null);
    setFailed(false);
    api.get(`/supplier-payments?purchase_id=${purchaseId}&limit=100`)
      .then((r) => setRows(r.data.items))
      .catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { if (open && purchaseId) load(); }, [open, purchaseId]);

  const anular = async (p) => {
    const ok = await ask({
      title: 'Anular pago',
      message: `¿Deseas anular el pago de ${fmtAmount(p.monto, p.moneda)} (${p.medio_pago}) del ${fmtDate(p.fecha_pago)}?`,
      confirmText: 'Anular pago',
    });
    if (!ok) return;
    try {
      await api.put(`/supplier-payments/${p.id}/cancel`, { motivo: 'Anulado desde el panel de pagos' });
      toast.success('Pago anulado');
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Pagos de la compra"
        icon={<Icon name="credit-card" size={18} />}
        size="lg"
      >
        {!rows && !failed && <Loader text="Cargando pagos..." />}
        {failed && <EmptyState title="Error al cargar pagos" hint="Verifica que el backend esté disponible" />}
        {rows && (
          rows.length ? (
            <div className="table-wrap">
              <table className="data" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Medio</th>
                    <th>Moneda</th>
                    <th style={{ textAlign: 'right' }}>Monto</th>
                    <th>N° operación</th>
                    <th>Estado</th>
                    <th style={{ textAlign: 'right' }}>Anulado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.fecha_pago)}</td>
                      <td><Badge kind="gray">{p.medio_pago}</Badge></td>
                      <td><Badge kind="gray">{p.moneda}</Badge></td>
                      <td className="money">{fmtAmount(p.monto, p.moneda)}</td>
                      <td className="text-muted">{p.numero_operacion || '—'}</td>
                      <td>{p.anulado ? <Badge kind="red">Anulado</Badge> : <Badge kind="green">Vigente</Badge>}</td>
                      <td>
                        {!p.anulado && (
                          <button className="btn-icon danger" onClick={() => anular(p)} title="Anular pago"><Icon name="cancel" size={14} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Sin pagos registrados" hint="Registra un pago desde las acciones de la compra" />
          )
        )}
        </Modal>
      {ConfirmDialog}
    </>
  );
}