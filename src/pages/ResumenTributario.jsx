import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import { Loader, ErrorState, EmptyState, fmtMoney } from '../components/ui';
import { buildElementPdfBlob } from '../components/DocPdf';
import TributaryReport from '../components/TributaryReport';
import { exportTributarioToExcel, downloadBlob, timestampName } from '../lib/exportTributario';
import { useAuth } from '../auth';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const REGIMEN_LABEL = {
  RMT: 'Régimen MYPE Tributario (RMT)',
  GENERAL: 'Régimen General',
  NRUS: 'Nuevo RUS (NRUS)',
};

const der = (v) => (v == null ? 0 : Number(v));

export default function ResumenTributario() {
  const { user } = useAuth();
  const toast = useToast();
  const actualYear = new Date().getFullYear();

  const [anio, setAnio] = useState(actualYear);
  const [mes, setMes] = useState(null); // null = todos los meses
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true); // solo la primera carga
  const [busy, setBusy] = useState(false); // recarga con datos ya visibles
  const [error, setError] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [report, setReport] = useState(null);
  const reportRef = useRef(null);
  const seqRef = useRef(0); // ignora respuestas de consultas viejas

  const years = useMemo(() => {
    const y = [];
    for (let i = actualYear; i >= actualYear - 5; i--) y.push(i);
    return y;
  }, [actualYear]);

  const load = async (y, m) => {
    const seq = ++seqRef.current;
    setError(false);
    if (data) {
      setBusy(true); // mantiene visible lo anterior mientras actualiza
    } else {
      setLoading(true); // sin datos previos → cargador inicial
    }
    try {
      const params = { anio: y };
      if (m) params.mes = m;
      const res = await api.get('/resumen-tributario', { params });
      if (seq !== seqRef.current) return; // llegó una consulta más nueva
      setData(res.data);
    } catch (e) {
      console.error(e);
      if (seq !== seqRef.current) return;
      setError(true);
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
        setBusy(false);
      }
    }
  };

  // Recarga automática al cambiar año o mes: las tarjetas y la tabla
  // muestran siempre el período seleccionado en el selector.
  useEffect(() => {
    load(anio, mes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anio, mes]);

  const r = data || {};
  const resumen = r.resumen || {};
  const detalle_igv = r.detalle_igv || {};
  const detalle_ir = r.detalle_ir || {};
  const config = r.config || {};
  const annual = r.annual || [];

  const mesSel = mes ?? null;
  const selectedKey = mesSel ? `${anio}-${String(mesSel).padStart(2, '0')}` : null;

  const chart = useMemo(
    () =>
      annual.map((x) => ({
        name: MESES_CORTOS[Number(String(x.mes).split('-')[1]) - 1],
        ventas: der(x.ventas_total),
        compras: der(x.compras_total),
        mes: x.mes,
      })),
    [annual]
  );

  const regimenLabel = REGIMEN_LABEL[config.ir_regime] || `Régimen ${config.ir_regime || 'RMT'}`;
  const tasaPct = der(detalle_ir.tasa) * 100;

  const exportExcel = async () => {
    if (!data) return;
    setExcelBusy(true);
    try {
      exportTributarioToExcel(data, { anio, mes });
      toast.success('Resumen tributario exportado a Excel');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setExcelBusy(false);
    }
  };

  const exportPdf = async () => {
    if (!data) return;
    setPdfBusy(true);
    try {
      setReport(data);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const blob = await buildElementPdfBlob(reportRef.current, { orientation: 'portrait' });
      const sufijo = mes ? String(mes).padStart(2, '0') : 'ANUAL';
      downloadBlob(blob, `resumen_tributario_${anio}_${sufijo}_${timestampName()}.pdf`);
      toast.success('Resumen tributario exportado a PDF');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setReport(null);
      setPdfBusy(false);
    }
  };

  // Sin información solo cuando el año completo no tiene movimientos:
  // si el mes elegido está vacío pero el año sí tiene datos, se muestra la
  // serie anual con ese mes en 0 y resaltado.
  const noInfo = !annual.some((x) => der(x.ventas_total) > 0 || der(x.compras_total) > 0);

  // Hook antes de cualquier early return (regla de los hooks).
  const filas = useMemo(
    () => (annual || []).filter((x) => (mes ? x.mes === selectedKey : true)),
    [annual, mes, selectedKey]
  );

  const periodoLabel = mes ? `${MESES[mes - 1]} de ${anio}` : `${anio} (todos los meses)`;
  const periodoCorto = mes ? `${MESES_CORTOS[mes - 1]} ${anio}` : `${anio}`;
  const cardPeriodo = mes ? `${MESES[mes - 1]} ${anio}` : `${anio} · todos los meses`;

  return (
    <div className="trib-page">
      <div className="page-head trib-head">
        <div>
          <h1 className="trib-title">
            <Icon name="bar-chart" size={20} style={{ color: 'var(--g-dark)' }} /> Resumen Tributario
          </h1>
          <p className="sub">IGV por pagar y pago a cuenta del Impuesto a la Renta</p>
        </div>

        <div className="trib-filters">
          <div className="trib-filters-inner">
            <select className="select" value={anio} onChange={(e) => setAnio(Number(e.target.value))} aria-label="Año" disabled={busy}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select className="select" value={mes ?? ''} onChange={(e) => setMes(e.target.value ? Number(e.target.value) : null)} aria-label="Mes" disabled={busy}>
              <option value="">Todos los meses</option>
              {MESES.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>

          <div className="trib-filter-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={exportExcel} disabled={excelBusy || !data || busy} title="Exporta el resumen tributario a Excel">
              {excelBusy ? <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> : <Icon name="download" size={14} />}
              Excel
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={exportPdf} disabled={pdfBusy || !data || busy} title="Genera un reporte PDF del resumen tributario">
              {pdfBusy ? <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} /> : <Icon name="document" size={14} />}
              PDF
            </button>
            <span className="pill-count trib-pill-loading">
              {busy ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> : null}
              {busy ? 'Calculando…' : periodoCorto}
            </span>
          </div>
        </div>
      </div>

      <div className={busy ? 'trib-content is-busy' : 'trib-content'}>
        {loading ? (
          <Loader text="Calculando resumen tributario..." />
        ) : error && !data ? (
          <ErrorState onRetry={() => load(anio, mes)} message="No se pudo cargar el resumen tributario" />
        ) : (
          <>
            {error && data && (
              <div className="trib-error-banner">
                <Icon name="info" size={15} /> No se pudo actualizar el resumen. Se muestran los datos anteriores.
              </div>
            )}

            {noInfo ? (
              <EmptyState
                title="No existen ventas ni compras registradas"
                hint={`Para el período ${periodoLabel} no hay comprobantes que generen IGV o IR. Registra ventas (facturas/boletas) o compras con factura para ver el resumen.`}
              />
            ) : (
              <>
                <div className="stat-grid">
            <div className="stat-card">
              <span className="ico green"><Icon name="shopping-cart" size={20} /></span>
              <div className="num">{fmtMoney(resumen.ventas_total)}</div>
              <div className="lbl">Ventas · {resumen.ventas_count} comprobante{resumen.ventas_count === 1 ? '' : 's'}</div>
              <div className="trib-card-period">{cardPeriodo}</div>
            </div>
            <div className="stat-card">
              <span className="ico blue"><Icon name="building" size={20} /></span>
              <div className="num">{fmtMoney(resumen.compras_total)}</div>
              <div className="lbl">Compras (crédito fiscal) · {resumen.compras_count}</div>
              <div className="trib-card-period">{cardPeriodo}</div>
            </div>
            <div className="stat-card">
              <span className="ico yellow"><Icon name="cash" size={20} /></span>
              <div className="num">{fmtMoney(resumen.igv_por_pagar)}</div>
              <div className="lbl">IGV por pagar</div>
              <div className="trib-card-period">{cardPeriodo}</div>
            </div>
            <div className="stat-card">
              <span className="ico red"><Icon name="settings" size={20} /></span>
              <div className="num">{fmtMoney(resumen.ir_pago_cuenta)}</div>
              <div className="lbl">Pago a cuenta IR</div>
              <div className="trib-card-period">{cardPeriodo}</div>
            </div>
            <div className="stat-card">
              <span className="ico green"><Icon name="bar-chart" size={20} /></span>
              <div className="num">{fmtMoney(resumen.total_referencial)}</div>
              <div className="lbl">Total referencial (IGV + IR)</div>
              <div className="trib-card-period">{cardPeriodo}</div>
            </div>
          </div>

          <div className="trib-details">
            <div className="card card-pad">
              <h3 className="trib-card-title">
                <Icon name="document" size={17} style={{ color: 'var(--g-dark)' }} /> Detalle del IGV
              </h3>
              <div className="sale-summary">
                <div className="line">
                  <span className="text-muted">IGV de ventas (Facturas + Boletas)</span>
                  <span className="money">{fmtMoney(detalle_igv.igv_ventas)}</span>
                </div>
                <div className="line">
                  <span className="text-muted">IGV de compras (crédito fiscal, solo FACTURAS)</span>
                  <span className="money">{fmtMoney(detalle_igv.igv_compras)}</span>
                </div>
                <div className="line total">
                  <span className="text-muted"><b>IGV por pagar</b></span>
                  <span className="money">{fmtMoney(detalle_igv.igv_por_pagar)}</span>
                </div>
                {der(detalle_igv.saldo_a_favor) > 0 && (
                  <div className="line">
                    <span className="text-muted">Saldo a favor</span>
                    <span className="money" style={{ color: 'var(--danger, #c0392b)' }}>{fmtMoney(detalle_igv.saldo_a_favor)}</span>
                  </div>
                )}
              </div>
              <p className="small-note trib-note">
                El IGV por pagar es la diferencia entre el IGV cobrado en ventas (facturas y boletas) y el IGV pagado en
                compras que otorgan crédito fiscal (solo comprobantes FACTURA en estado confirmado o recibido).
              </p>
            </div>

            <div className="card card-pad">
              <h3 className="trib-card-title">
                <Icon name="settings" size={17} style={{ color: 'var(--g-dark)' }} /> Pago a cuenta del IR
              </h3>
              <div className="sale-summary">
                <div className="line">
                  <span className="text-muted">Régimen</span>
                  <span className="money">{regimenLabel}</span>
                </div>
                <div className="line">
                  <span className="text-muted">Tasa</span>
                  <span className="money">{tasaPct.toLocaleString('es-PE')}%</span>
                </div>
                <div className="line">
                  <span className="text-muted">Ingresos netos (base imponible)</span>
                  <span className="money">{fmtMoney(detalle_ir.ingresos_netos)}</span>
                </div>
                <div className="line total">
                  <span className="text-muted"><b>Pago a cuenta del IR</b></span>
                  <span className="money">{fmtMoney(detalle_ir.pago_cuenta)}</span>
                </div>
              </div>
              <p className="small-note trib-note">
                El pago a cuenta se estima multiplicando los ingresos netos (ventas de facturas y boletas, sin IGV) por la
                tasa del régimen ({regimenLabel}, {tasaPct.toLocaleString('es-PE')}%). No equivale a un cálculo entre ventas y
                compras.
              </p>
            </div>
          </div>

          <div className="card card-pad trib-chart-card">
            <h3 className="trib-card-title">
              <Icon name="bar-chart" size={17} style={{ color: 'var(--g-dark)' }} /> Ventas vs compras · {anio}
            </h3>
            <div className="chart-box">
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ top: 6, right: 6, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e3ece5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#68806f' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#68806f' }} axisLine={false} tickLine={false} tickFormatter={(v) => `S/${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                  <Tooltip formatter={(v, name) => [fmtMoney(v), name === 'ventas' ? 'Ventas' : 'Compras']} contentStyle={{ borderRadius: 12, border: '1px solid #e3ece5', fontSize: 13 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="ventas" name="Ventas" fill="#1d7a33" radius={[4, 4, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="compras" name="Compras" fill="#e0a800" radius={[4, 4, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="table-wrap trib-table-wrap">
            <table className="data trib-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th data-label="Ventas">Ventas</th>
                  <th data-label="IGV ventas">IGV ventas</th>
                  <th data-label="Compras">Compras</th>
                  <th data-label="IGV compras">IGV compras</th>
                  <th data-label="IGV a pagar">IGV a pagar</th>
                  <th data-label="Pago a cuenta IR">Pago a cuenta IR</th>
                  <th data-label="Total referencial">Total referencial</th>
                </tr>
              </thead>
              <tfoot>
                <tr className={selectedKey ? `trib-total-${selectedKey}` : ''}>
                  <td data-label="Resumen del período">Total {mes ? MESES[mes - 1] : 'anual'}</td>
                  <td data-label="Ventas"><b>{fmtMoney(resumen.ventas_total)}</b></td>
                  <td data-label="IGV ventas"><b>{fmtMoney(resumen.ventas_igv)}</b></td>
                  <td data-label="Compras"><b>{fmtMoney(resumen.compras_total)}</b></td>
                  <td data-label="IGV compras"><b>{fmtMoney(resumen.compras_igv)}</b></td>
                  <td data-label="IGV a pagar"><b>{fmtMoney(resumen.igv_por_pagar)}</b></td>
                  <td data-label="Pago a cuenta IR"><b>{fmtMoney(resumen.ir_pago_cuenta)}</b></td>
                  <td data-label="Total referencial"><b>{fmtMoney(resumen.total_referencial)}</b></td>
                </tr>
              </tfoot>
              <tbody>
                {filas.map((x) => {
                  const m = Number(String(x.mes).split('-')[1]);
                  const active = selectedKey === x.mes;
                  return (
                    <tr key={x.mes} className={active ? 'trib-row-active' : ''}>
                      <td data-label="Mes"><b>{MESES[m - 1]}</b>{active ? <span className="trib-chip">PERÍODO SELECCIONADO</span> : null}</td>
                      <td data-label="Ventas" className="money">{fmtMoney(x.ventas_total)}</td>
                      <td data-label="IGV ventas" className="money">{fmtMoney(x.ventas_igv)}</td>
                      <td data-label="Compras" className="money">{fmtMoney(x.compras_total)}</td>
                      <td data-label="IGV compras" className="money">{fmtMoney(x.compras_igv)}</td>
                      <td data-label="IGV a pagar" className="money">{fmtMoney(x.igv_por_pagar)}</td>
                      <td data-label="Pago a cuenta IR" className="money">{fmtMoney(x.ir_pago_cuenta)}</td>
                      <td data-label="Total referencial" className="money"><b>{fmtMoney(x.total_referencial)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="trib-disclaimer">
              <p className="small-note">
                Valores informativos calculados con los montos de la base de datos. Confirma todos los importes con tu
                contador antes de realizar declaraciones o pagos ante la SUNAT. Este módulo no sustituye la declaración del
                PDT ni el pago de impuestos.
              </p>
              <div className="small-note trib-sunat">
                SUNAT · Impuesto General a las Ventas (IGV) e Impuesto a la Renta (IR) de tercera categoría.
              </div>
            </div>
              </>
            )}
          </>
        )}
      </div>

      {report && (
        <div className="report-offscreen" aria-hidden="true">
          <TributaryReport ref={reportRef} data={report} anio={anio} mes={mes} user={user} />
        </div>
      )}
    </div>
  );
}