import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Modal, ConfirmModal, useConfirm } from '../components/Modal';
import { Loader, ErrorState, EmptyState, fmtMoney, fmtDate, Badge, useListReload } from '../components/ui';
import { Pagination } from '../components/Pagination';
import { useAuth } from '../auth';

/* ============================================================
   ConfiguraciÃ³n tributaria: gastos deducibles, pagos a cuenta
   del IR, UIT por aÃ±o y tramos del IR anual.
   ============================================================ */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const CATEGORIAS = [
  ['COMPRA_MERCADERIA', 'Compra de mercaderÃ­a'],
  ['SERVICIOS', 'Servicios'],
  ['ALQUILER', 'Alquiler'],
  ['TRANSPORTE', 'Transporte'],
  ['SERVICIOS_PROFESIONALES', 'Servicios profesionales'],
  ['GASTOS_BANCARIOS', 'Gastos bancarios'],
  ['OTROS_GASTOS', 'Otros gastos'],
];

const ESTADOS_GASTO = [
  ['BORRADOR', 'Borrador', 'gray'],
  ['VALIDO', 'VÃ¡lido', 'green'],
  ['ANULADO', 'Anulado', 'red'],
];

const ESTADOS_PAGO = [
  ['PENDIENTE', 'Pendiente', 'gray'],
  ['PAGADO', 'Pagado', 'green'],
  ['ANULADO', 'Anulado', 'red'],
];

const REGIMENES = [
  ['RMT', 'RMT (MYPE Tributario)'],
  ['GENERAL', 'RÃ©gimen General'],
  ['NRUS', 'Nuevo RUS'],
];

const label = (pairs, value, idx = 1) => (pairs.find((p) => p[0] === value) || [, value])[idx];
const kind = (pairs, value) => (pairs.find((p) => p[0] === value) || [, , 'gray'])[2];

const MONEDA_SIMBOLO = { PEN: 'S/', USD: '$', EUR: '€' };
const fmtMonto = (n, moneda) =>
  `${MONEDA_SIMBOLO[moneda] || ''} ${Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();

const todayISO = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v === '' || v == null ? '' : String(v));

export default function ConfigTributaria() {
  const { can } = useAuth();
  const toast = useToast();
  const { ask, ConfirmDialog } = useConfirm();
  const puedeEditar = can('RESUMEN_TRIBUTARIO_EDIT');

  const [tab, setTab] = useState('gastos');
  const actualYear = new Date().getFullYear();
  const [anio, setAnio] = useState(actualYear);

  const years = useMemo(() => {
    const y = [];
    for (let i = actualYear + 1; i >= actualYear - 5; i--) y.push(i);
    return y;
  }, [actualYear]);

  return (
    <div>
      <ConfirmDialog />
      <div className="page-head">
        <div>
          <h1 className="flex">
            <Icon name="document" size={20} /> ConfiguraciÃ³n tributaria
          </h1>
          <p className="text-muted">
            Registra los gastos deducibles, los pagos a cuenta del IR, el valor de la UIT y los tramos del
            impuesto anual. El resumen tributario usa estos datos como fuente oficial del cÃ¡lculo.
          </p>
        </div>
        {tab !== 'gastos' && (
          <select className="select" style={{ width: 'auto' }} value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {[
          ['gastos', 'Gastos deducibles'],
          ['pagos', 'Pagos a cuenta IR'],
          ['uit', 'UIT'],
          ['tramos', 'Tramos del IR'],
        ].map(([k, t]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'gastos' && <GastosDeducibles anio={anio} setAnio={setAnio} years={years} puedeEditar={puedeEditar} toast={toast} ask={ask} />}
      {tab === 'pagos' && <PagosCuenta anio={anio} puedeEditar={puedeEditar} toast={toast} ask={ask} />}
      {tab === 'uit' && <Uit anio={anio} puedeEditar={puedeEditar} toast={toast} ask={ask} />}
      {tab === 'tramos' && <TramosIr puedeEditar={puedeEditar} toast={toast} ask={ask} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gastos deducibles                                                   */
/* ------------------------------------------------------------------ */

const GASTO_VACIO = {
  fecha_gasto: todayISO(),
  categoria: 'SERVICIOS',
  descripcion: '',
  proveedor: '',
  documento_tipo: 'FACTURA',
  documento_numero: '',
  moneda: 'PEN',
  tipo_cambio: '1',
  monto: '',
  estado: 'VALIDO',
  observaciones: '',
};

function GastosDeducibles({ anio, setAnio, years, puedeEditar, toast, ask }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [categoria, setCategoria] = useState('');
  const [estado, setEstado] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError(false);
    const params = { page, limit, anio };
    if (categoria) params.categoria = categoria;
    if (estado) params.estado = estado;
    return api
      .get('/gastos-deducibles', { params })
      .then((r) => setData(r.data))
      .catch((e) => {
        console.error(e);
        setError(true);
      });
  }, [anio, page, limit, categoria, estado]);

  useEffect(() => { load(); }, [load]);
  const reload = useListReload(page, setPage, load);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, monto: Number(form.monto), tipo_cambio: Number(form.tipo_cambio) };
      if (form.id) await api.put(`/gastos-deducibles/${form.id}`, payload);
      else await api.post('/gastos-deducibles', payload);
      toast.success(form.id ? 'Gasto deducible actualizado' : 'Gasto deducible registrado');
      setForm(null);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g) => {
    const ok = await ask({ message: `Â¿Eliminar el gasto "${g.descripcion}" por ${fmtMoney(g.monto_pen)}?` });
    if (!ok) return;
    try {
      await api.delete(`/gastos-deducibles/${g.id}`);
      toast.success('Gasto eliminado');
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (error) return <ErrorState onRetry={load} />;
  if (!data) return <Loader />;

  return (
    <div>
      <div className="toolbar">
        <select className="select" style={{ width: 'auto' }} value={anio} onChange={(e) => { setPage(1); setAnio(Number(e.target.value)); }}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={categoria} onChange={(e) => { setPage(1); setCategoria(e.target.value); }}>
          <option value="">Todas las categorÃ­as</option>
          {CATEGORIAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={estado} onChange={(e) => { setPage(1); setEstado(e.target.value); }}>
          <option value="">Todos los estados</option>
          {ESTADOS_GASTO.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <span className="pill-count">{data.pagination.total} registros</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="text-muted" style={{ fontSize: 12.5 }}>
            Total vÃ¡lido: <b className="money" style={{ color: 'var(--g-forest)' }}>{fmtMoney(data.total_valido)}</b>
          </span>
          {puedeEditar && (
            <button className="btn btn-primary" onClick={() => setForm({ ...GASTO_VACIO, fecha_gasto: `${anio}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`.slice(0, 10) })}>
              <Icon name="plus" size={15} /> Nuevo gasto
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>CategorÃ­a</th>
                <th>DescripciÃ³n</th>
                <th>Documento</th>
                <th className="num">Monto</th>
                <th className="num">Total (S/)</th>
                <th>Estado</th>
                {puedeEditar && <th />}
              </tr>
            </thead>
            <tbody>
              {data.items.map((g) => (
                <tr key={g.id}>
                  <td className="text-muted">{fmtDate(g.fecha_gasto)}</td>
                  <td>{label(CATEGORIAS, g.categoria)}</td>
                  <td>
                    <div className="cell-title">{g.descripcion}</div>
                    {g.proveedor && <div className="text-muted" style={{ fontSize: 12 }}>{g.proveedor}</div>}
                  </td>
                  <td className="text-muted">
                    {g.documento_tipo || '-'}
                    {g.documento_numero ? ` ${g.documento_numero}` : ''}
                  </td>
                  <td className="money">{fmtMonto(g.monto, g.moneda)}</td>
                  <td className="money" style={{ fontWeight: 700 }}>{fmtMoney(g.monto_pen)}</td>
                  <td><Badge kind={kind(ESTADOS_GASTO, g.estado)}>{label(ESTADOS_GASTO, g.estado)}</Badge></td>
                  {puedeEditar && (
                    <td>
                      <div className="row-actions">
                        <button className="btn-icon" onClick={() => setForm({ ...g, monto: num(g.monto), tipo_cambio: num(g.tipo_cambio) })} title="Editar">
                          <Icon name="edit" size={14} />
                        </button>
                        <button className="btn-icon" onClick={() => remove(g)} title="Eliminar">
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.items.length === 0 && <EmptyState title="Sin gastos deducibles" hint="Registra los gastos que sustentan la declaraciÃ³n anual." />}
      </div>

      <Pagination
        currentPage={data.pagination.page}
        totalPages={data.pagination.total_pages}
        totalItems={data.pagination.total}
        limit={data.pagination.limit}
        onPageChange={setPage}
      />

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Editar gasto deducible' : 'Nuevo gasto deducible'}
        icon={<Icon name="money" size={18} />}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : <Icon name="checkmark" size={15} />} Guardar
            </button>
          </>
        }
      >
        {form && (
          <>
            <div className="grid-2">
              <div className="field">
                <label className="label">Fecha del gasto *</label>
                <input className="input" type="date" value={form.fecha_gasto} onChange={set('fecha_gasto')} />
                <div className="hint">El aÃ±o y el mes se derivan de esta fecha.</div>
              </div>
              <div className="field">
                <label className="label">CategorÃ­a *</label>
                <select className="select" value={form.categoria} onChange={set('categoria')}>
                  {CATEGORIAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label className="label">DescripciÃ³n *</label>
              <input className="input" value={form.descripcion} onChange={set('descripcion')} placeholder="Ej. Alquiler del local â€” julio" />
            </div>
            <div className="grid-3">
              <div className="field">
                <label className="label">Proveedor</label>
                <input className="input" value={form.proveedor || ''} onChange={set('proveedor')} />
              </div>
              <div className="field">
                <label className="label">Tipo de documento</label>
                <select className="select" value={form.documento_tipo || ''} onChange={set('documento_tipo')}>
                  <option value="">â€”</option>
                  {['FACTURA', 'BOLETA', 'RECIBO DE LUZ', 'RECIBO DE AGUA', 'RECIBO DE GAS', 'NOTA DE VENTA', 'OTRO'].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">NÂº de documento</label>
                <input className="input" value={form.documento_numero || ''} onChange={set('documento_numero')} />
              </div>
            </div>
            <div className="grid-4">
              <div className="field">
                <label className="label">Moneda</label>
                <select className="select" value={form.moneda} onChange={set('moneda')}>
                  <option value="PEN">Soles</option>
                  <option value="USD">DÃ³lares</option>
                  <option value="EUR">Euros</option>
                </select>
              </div>
              <div className="field">
                <label className="label">Tipo de cambio</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={form.tipo_cambio}
                  onChange={set('tipo_cambio')}
                  disabled={form.moneda === 'PEN'}
                />
              </div>
              <div className="field">
                <label className="label">Monto *</label>
                <input className="input" type="number" min="0" step="0.01" value={form.monto} onChange={set('monto')} />
              </div>
              <div className="field">
                <label className="label">Total en soles</label>
                <input
                  className="input money"
                  readOnly
                  value={fmtMoney(Number(form.monto || 0) * Number(form.tipo_cambio || 1))}
                />
              </div>
            </div>
            <div className="field">
              <label className="label">Estado</label>
              <select className="select" value={form.estado} onChange={set('estado')}>
                {ESTADOS_GASTO.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
              <div className="hint">Solo los gastos en estado VÃ¡lido se descuentan en la declaraciÃ³n anual.</div>
            </div>
            <div className="field">
              <label className="label">Observaciones</label>
              <textarea className="input" rows={2} value={form.observaciones || ''} onChange={set('observaciones')} />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pagos a cuenta del IR                                               */
/* ------------------------------------------------------------------ */

function PagosCuenta({ anio, puedeEditar, toast, ask }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError(false);
    return api
      .get('/pagos-cuenta-ir', { params: { anio } })
      .then((r) => setData(r.data))
      .catch((e) => {
        console.error(e);
        setError(true);
      });
  }, [anio]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        anio,
        ingresos_netos: Number(form.ingresos_netos),
        tasa: Number(form.tasa),
        monto_calculado: Number(form.monto_calculado),
        monto_pagado: Number(form.monto_pagado || 0),
      };
      if (form.pago_cuenta_id) await api.put(`/pagos-cuenta-ir/${form.pago_cuenta_id}`, payload);
      else await api.post('/pagos-cuenta-ir', payload);
      toast.success(form.pago_cuenta_id ? 'Pago a cuenta actualizado' : 'Pago a cuenta registrado');
      setForm(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    const ok = await ask({
      title: 'Eliminar pago a cuenta',
      message: `Â¿Eliminar el pago a cuenta de ${p.mes_nombre} ${anio}?`,
    });
    if (!ok) return;
    try {
      await api.delete(`/pagos-cuenta-ir/${p.pago_cuenta_id}`);
      toast.success('Pago a cuenta eliminado');
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (error) return <ErrorState onRetry={load} />;
  if (!data) return <Loader />;

  return (
    <div>
      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Mes</th>
                <th className="num">Ingresos netos</th>
                <th className="num">Tasa</th>
                <th className="num">Calculado</th>
                <th className="num">Pagado</th>
                <th className="num">Diferencia</th>
                <th>Estado</th>
                {puedeEditar && <th />}
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.mes}>
                  <td className="cell-title">{p.mes_nombre}</td>
                  <td className="money">{fmtMoney(p.ingresos_netos)}</td>
                  <td className="money text-muted">{(Number(p.tasa) * 100).toFixed(2)}%</td>
                  <td className="money">{fmtMoney(p.monto_calculado)}</td>
                  <td className="money" style={{ fontWeight: p.monto_pagado ? 700 : 400 }}>{fmtMoney(p.monto_pagado)}</td>
                  <td className="money" style={{ color: Number(p.diferencia) > 0 ? 'var(--danger)' : 'var(--g-primary)' }}>
                    {fmtMoney(p.diferencia)}
                  </td>
                  <td><Badge kind={kind(ESTADOS_PAGO, p.estado)}>{label(ESTADOS_PAGO, p.estado)}</Badge></td>
                  {puedeEditar && (
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn-icon"
                          title={p.registrado ? 'Editar pago' : 'Registrar pago'}
                          onClick={() =>
                            setForm({
                              mes: p.mes,
                              mes_nombre: p.mes_nombre,
                              pago_cuenta_id: p.pago_cuenta_id,
                              ingresos_netos: num(p.monto_calculado_reg ?? p.ingresos_netos),
                              tasa: num(p.tasa_reg ?? p.tasa),
                              monto_calculado: num(p.monto_calculado_reg ?? p.monto_calculado),
                              monto_pagado: num(p.monto_pagado || ''),
                              fecha_pago: p.fecha_pago || '',
                              numero_operacion: p.numero_operacion || '',
                              entidad: p.entidad || '',
                              estado: p.estado || 'PENDIENTE',
                              observaciones: p.observaciones || '',
                            })
                          }
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        {p.registrado && (
                          <button className="btn-icon" onClick={() => remove(p)} title="Eliminar">
                            <Icon name="trash" size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><b>Total pagado</b></td>
                <td colSpan={5} />
                <td className="money"><b>{fmtMoney(data.total_pagado)}</b></td>
                <td colSpan={puedeEditar ? 1 : 0} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.pago_cuenta_id ? `Editar pago â€” ${form.mes_nombre} ${anio}` : `Registrar pago â€” ${form?.mes_nombre || ''} ${anio}`}
        icon={<Icon name="money" size={18} />}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : <Icon name="checkmark" size={15} />} Guardar
            </button>
          </>
        }
      >
        {form && (
          <>
            <div className="grid-3">
              <div className="field">
                <label className="label">Ingresos netos *</label>
                <input className="input" type="number" min="0" step="0.01" value={form.ingresos_netos} onChange={set('ingresos_netos')} />
                <div className="hint">Base imponible de las ventas del mes.</div>
              </div>
              <div className="field">
                <label className="label">Tasa *</label>
                <input className="input" type="number" min="0" step="0.0001" value={form.tasa} onChange={set('tasa')} />
                <div className="hint">FracciÃ³n: 0.01 = 1%.</div>
              </div>
              <div className="field">
                <label className="label">Monto calculado</label>
                <input className="input" type="number" min="0" step="0.01" value={form.monto_calculado} onChange={set('monto_calculado')} />
              </div>
            </div>
            <div className="grid-2">
              <div className="field">
                <label className="label">Monto pagado</label>
                <input className="input" type="number" min="0" step="0.01" value={form.monto_pagado} onChange={set('monto_pagado')} />
              </div>
              <div className="field">
                <label className="label">Estado</label>
                <select className="select" value={form.estado} onChange={set('estado')}>
                  {ESTADOS_PAGO.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="grid-3">
              <div className="field">
                <label className="label">Fecha de pago</label>
                <input className="input" type="date" value={form.fecha_pagado || form.fecha_pago} onChange={set('fecha_pago')} />
                <div className="hint">Obligatoria si el estado es Pagado.</div>
              </div>
              <div className="field">
                <label className="label">NÂº de operaciÃ³n</label>
                <input className="input" value={form.numero_operacion} onChange={set('numero_operacion')} />
              </div>
              <div className="field">
                <label className="label">Entidad</label>
                <input className="input" value={form.entidad} onChange={set('entidad')} placeholder="SUNAT / BBVA" />
              </div>
            </div>
            <div className="field">
              <label className="label">Observaciones</label>
              <textarea className="input" rows={2} value={form.observaciones} onChange={set('observaciones')} />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UIT por aÃ±o                                                         */
/* ------------------------------------------------------------------ */

function Uit({ anio, puedeEditar, toast, ask }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError(false);
    return api
      .get('/uit')
      .then((r) => setData(r.data))
      .catch((e) => {
        console.error(e);
        setError(true);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/uit/${form.anio}`, { valor_uit: Number(form.valor_uit), descripcion: form.descripcion || null });
      toast.success('UIT guardada');
      setForm(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  if (error) return <ErrorState onRetry={load} />;
  if (!data) return <Loader />;

  const byYear = new Map(data.items.map((i) => [i.anio, i]));

  return (
    <div>
      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>AÃ±o</th>
                <th className="num">Valor de la UIT (S/)</th>
                <th>DescripciÃ³n</th>
                {puedeEditar && <th />}
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.anio}>
                  <td className="cell-title">
                    {u.anio}
                    {u.anio === new Date().getFullYear() && <span className="text-muted" style={{ fontSize: 12 }}> Â· vigente</span>}
                  </td>
                  <td className="money" style={{ fontWeight: 700 }}>{fmtMoney(u.valor_uit)}</td>
                  <td className="text-muted">{u.descripcion || '-'}</td>
                  {puedeEditar && (
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn-icon"
                          title="Editar"
                          onClick={() => setForm({ anio: u.anio, valor_uit: num(u.valor_uit), descripcion: u.descripcion || '' })}
                        >
                          <Icon name="edit" size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.items.length === 0 && <EmptyState title="Sin UIT configuradas" hint="Registra el valor de la UIT de cada aÃ±o para el cÃ¡lculo del IR anual." />}
      </div>

      {!byYear.has(anio) && (
        <div className="card" style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="cell-title">Falta la UIT del {anio}</div>
            <div className="text-muted" style={{ fontSize: 12.5 }}>
              Sin el valor de la UIT de {anio} el impuesto anual se calcula como referencial.
            </div>
          </div>
          {puedeEditar && (
            <button className="btn btn-primary" onClick={() => setForm({ anio, valor_uit: '', descripcion: '' })}>
              <Icon name="plus" size={15} /> Registrar UIT {anio}
            </button>
          )}
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={`UIT ${form?.anio || ''}`}
        icon={<Icon name="document" size={18} />}
        size="sm"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : <Icon name="checkmark" size={15} />} Guardar
            </button>
          </>
        }
      >
        {form && (
          <>
            <div className="field">
              <label className="label">Valor de la UIT (S/) *</label>
              <input className="input" type="number" min="0" step="0.01" value={form.valor_uit} onChange={(e) => setForm((f) => ({ ...f, valor_uit: e.target.value }))} />
              <div className="hint">Valor vigente de la Unidad Impositiva Tributaria para ese aÃ±o.</div>
            </div>
            <div className="field">
              <label className="label">DescripciÃ³n</label>
              <input className="input" value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} placeholder="Ej. UIT 2026 â€” Ley NÂ° ..." />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tramos del IR anual                                                 */
/* ------------------------------------------------------------------ */

function TramosIr({ puedeEditar, toast, ask }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError(false);
    return api
      .get('/ir-tramos')
      .then((r) => setData(r.data))
      .catch((e) => {
        console.error(e);
        setError(true);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        regimen: form.regimen,
        desde_uit: Number(form.desde_uit),
        hasta_uit: form.hasta_uit === '' ? null : Number(form.hasta_uit),
        tasa: Number(form.tasa),
        descripcion: form.descripcion || null,
      };
      await api.post('/ir-tramos', payload);
      toast.success('Tramo agregado');
      setForm(null);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t) => {
    const ok = await ask({
      message: `Â¿Eliminar el tramo de ${t.desde_uit} a ${t.hasta_uit ?? 'âˆž'} UIT en ${label(REGIMENES, t.regimen, 0)}?`,
    });
    if (!ok) return;
    try {
      await api.delete(`/ir-tramos/${t.id}`);
      toast.success('Tramo eliminado');
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (error) return <ErrorState onRetry={load} />;
  if (!data) return <Loader />;

  const porRegimen = data.items.reduce((acc, t) => {
    (acc[t.regimen] = acc[t.regimen] || []).push(t);
    return acc;
  }, {});

  return (
    <div>
      <div className="toolbar">
        <span className="pill-count">{data.items.length} tramos</span>
        {puedeEditar && (
          <button
            className="btn btn-primary"
            style={{ marginLeft: 'auto' }}
            onClick={() => setForm({ regimen: 'RMT', desde_uit: '0', hasta_uit: '', tasa: '', descripcion: '' })}
          >
            <Icon name="plus" size={15} /> Nuevo tramo
          </button>
        )}
      </div>

      {Object.keys(porRegimen).length === 0 ? (
        <div className="card">
          <EmptyState
            title="Sin tramos configurados"
            hint="Sin tramos el impuesto anual se muestra como referencial y no debe usarse para declarar."
          />
        </div>
      ) : (
        Object.entries(porRegimen).map(([reg, items]) => (
          <div className="card" key={reg} style={{ marginBottom: 14 }}>
            <div className="card-pad" style={{ paddingBottom: 0 }}>
              <h3 className="flex"><Icon name="document" size={16} /> {label(REGIMENES, reg, 1) || reg}</h3>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="num">Desde (UIT)</th>
                    <th className="num">Hasta (UIT)</th>
                    <th className="num">Tasa</th>
                    <th>DescripciÃ³n</th>
                    {puedeEditar && <th />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.id}>
                      <td className="money">{fmtMoney(t.desde_uit)}</td>
                      <td className="money">{t.hasta_uit == null ? 'En adelante' : fmtMoney(t.hasta_uit)}</td>
                      <td className="money" style={{ fontWeight: 700 }}>{(Number(t.tasa) * 100).toFixed(1)}%</td>
                      <td className="text-muted">{t.descripcion || '-'}</td>
                      {puedeEditar && (
                        <td>
                          <div className="row-actions">
                            <button className="btn-icon" onClick={() => remove(t)} title="Eliminar">
                              <Icon name="trash" size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="Nuevo tramo del IR"
        icon={<Icon name="document" size={18} />}
        size="sm"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : <Icon name="checkmark" size={15} />} Guardar
            </button>
          </>
        }
      >
        {form && (
          <>
            <div className="field">
              <label className="label">RÃ©gimen *</label>
              <select className="select" value={form.regimen} onChange={set('regimen')}>
                {REGIMENES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            <div className="grid-3">
              <div className="field">
                <label className="label">Desde (UIT) *</label>
                <input className="input" type="number" min="0" step="0.001" value={form.desde_uit} onChange={set('desde_uit')} />
              </div>
              <div className="field">
                <label className="label">Hasta (UIT)</label>
                <input className="input" type="number" min="0" step="0.001" value={form.hasta_uit} onChange={set('hasta_uit')} />
                <div className="hint">VacÃ­o = sin lÃ­mite.</div>
              </div>
              <div className="field">
                <label className="label">Tasa *</label>
                <input className="input" type="number" min="0" max="1" step="0.001" value={form.tasa} onChange={set('tasa')} placeholder="0.10" />
                <div className="hint">FracciÃ³n: 0.10 = 10%.</div>
              </div>
            </div>
            <div className="field">
              <label className="label">DescripciÃ³n</label>
              <input className="input" value={form.descripcion} onChange={set('descripcion')} />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
