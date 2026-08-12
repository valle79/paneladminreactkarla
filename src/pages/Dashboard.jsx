import { useEffect, useState } from 'react';
import {
  Users, Tractor, Wrench, UserRound, ShoppingCart, Tags, TrendingUp,
  DollarSign, CalendarRange, ChevronRight, Factory,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { api, errMsg } from '../api';
import { useToast } from '../components/Toast';
import {
  Loader, ErrorState, fmtMoney, fmtDateTime, StatusBadge, DocTypeBadge, InvoiceBadge,
} from '../components/ui';

export default function Dashboard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    api.get('/stats')
      .then((r) => setData(r.data))
      .catch((e) => { setFailed(true); toast.error(errMsg(e)); });
  };
  useEffect(() => { load(); }, []);

  if (!data) return failed ? <ErrorState onRetry={load} message="No se pudieron cargar los indicadores" /> : <Loader text="Cargando indicadores..." />;

  const cards = [
    { icon: Users, label: 'Asesores', num: data.counts.advisors, cls: 'green' },
    { icon: Tractor, label: 'Productos', num: data.counts.products, cls: 'yellow' },
    { icon: Wrench, label: 'Repuestos', num: data.counts.spare_parts, cls: 'blue' },
    { icon: UserRound, label: 'Clientes', num: data.counts.clients + data.counts.clients_ruc, cls: 'green' },
    { icon: ShoppingCart, label: 'Ventas', num: data.counts.sales, cls: 'red' },
    { icon: Tags, label: 'Promociones', num: data.counts.promotions, cls: 'yellow' },
  ];

  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const chart = [...(data.monthly || [])].reverse().map((m) => ({
    name: months[Number(m.mes.split('-')[1]) - 1],
    total: Number(m.total),
  }));

  const docPrefix = { boleta: 'B', factura: 'F', proforma: 'P', cotizacion: 'C' };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">Resumen general del sistema · Fabricaciones & Servicios El Iqueño SAC</div>
        </div>
        <span className="chip" style={{ fontSize: 12.5, padding: '7px 14px' }}>
          <Factory size={14} /> Sistema de control integral
        </span>
      </div>

      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className={`ico ${c.cls}`}><c.icon size={20} /></div>
            <div className="num">{c.num}</div>
            <div className="lbl">{c.label} registrados</div>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <div className="dash-card">
          <h3><TrendingUp size={17} color="var(--g-dark)" /> Ventas de los últimos meses</h3>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={chart} margin={{ top: 6, right: 6, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#29a744" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#29a744" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e3ece5" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#68806f' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#68806f' }} axisLine={false} tickLine={false} tickFormatter={(v) => `S/${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                <Tooltip formatter={(v) => [fmtMoney(v), 'Total']} contentStyle={{ borderRadius: 12, border: '1px solid #e3ece5', fontSize: 13 }} />
                <Area type="monotone" dataKey="total" stroke="#1d7a33" strokeWidth={2.5} fill="url(#gv)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="dash-card">
          <h3><DollarSign size={17} color="var(--y-dark)" /> Totales generales</h3>
          <div className="sale-summary">
            <div className="line"><span className="text-muted">Ventas cobradas</span><b>{data.counts.sales}</b></div>
            <div className="line"><span className="text-muted">Subtotal</span><span className="money">{fmtMoney(data.totals?.subtotal)}</span></div>
            <div className="line"><span className="text-muted">IGV (18%)</span><span className="money">{fmtMoney(data.totals?.igv)}</span></div>
            <div className="line total"><span>Total cobrado</span><span className="money">{fmtMoney(data.totals?.total)}</span></div>
          </div>
          <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <CalendarRange size={15} /> Monto acumulado de ventas con pago pagado/a cuenta.
          </div>
        </div>
      </div>

      <div className="dash-card mt-20">
        <h3><ShoppingCart size={17} color="var(--g-dark)" /> Últimas ventas</h3>
        <div className="table-wrap" style={{ border: 'none', boxShadow: 'none' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Cliente</th>
                <th>Total</th>
                <th>Estado de pago</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {(data.recent || []).map((s) => (
                <tr key={s.id}>
                  <td>
                    <InvoiceBadge type={s.invoice_type} number={s.invoice_number} />
                    {' '}<DocTypeBadge type={s.invoice_type} />
                  </td>
                  <td className="text-muted">—</td>
                  <td className="money"><b>{fmtMoney(s.total)}</b></td>
                  <td><StatusBadge value={s.payment_status} /></td>
                  <td className="text-muted">{fmtDateTime(s.created_at)}</td>
                </tr>
              ))}
              {!data.recent?.length && (
                <tr><td colSpan={5}><span className="text-muted">Aún no hay ventas registradas</span></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}