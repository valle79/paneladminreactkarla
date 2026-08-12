import { Search, Inbox, Loader2, Download, ExternalLink, WifiOff, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { assetUrl } from '../api';

export function Loader({ text = 'Cargando...' }) {
  return (
    <div className="table-loader">
      <span className="spinner" /> {text}
    </div>
  );
}

export function ErrorState({ onRetry, message = 'No se pudieron cargar los datos' }) {
  return (
    <div className="empty-state">
      <WifiOff size={42} strokeWidth={1.4} />
      <b style={{ color: 'var(--ink)', fontSize: 14.5 }}>{message}</b>
      <span style={{ fontSize: 13, maxWidth: 380, textAlign: 'center' }}>
        Verifica que el backend esté corriendo (puerto 8000) y que la base de datos esté conectada.
      </span>
      {onRetry && (
        <button className="btn btn-primary mt-8" onClick={onRetry}>
          <RotateCcw size={15} /> Reintentar
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title = 'Sin registros', hint = 'No hay datos que mostrar todavía' }) {
  return (
    <div className="empty-state">
      <Inbox size={42} strokeWidth={1.4} />
      <b style={{ color: 'var(--ink)', fontSize: 14.5 }}>{title}</b>
      <span style={{ fontSize: 13 }}>{hint}</span>
    </div>
  );
}

export function PageLoader({ text = 'Cargando panel...' }) {
  return (
    <div className="page-loader">
      <span className="spinner lg" />
      <span>{text}</span>
    </div>
  );
}

export function Toolbar({ search, onSearch, placeholder = 'Buscar...', children }) {
  return (
    <div className="toolbar">
      {search !== undefined && (
        <div className="search">
          <Search size={16} />
          <input
            className="input"
            placeholder={placeholder}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      )}
      <div style={{ flex: 1 }} />
      {children}
    </div>
  );
}

export function useSearch(data, keys) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    if (!q.trim()) return data;
    const term = q.toLowerCase();
    return (data || []).filter((row) =>
      keys.some((k) => {
        const v = k(row);
        return v == null ? false : String(v).toLowerCase().includes(term);
      })
    );
  }, [data, q, keys]);
  return { q, setQ, filtered };
}

export function ImageCell({ src, alt = 'imagen', width = 58 }) {
  return (
    <span className="thumb-wrap" style={{ width, height: width }}>
      {src ? (
        <span className="img-link">
          <a href={assetUrl(src)} target="_blank" rel="noreferrer">
            <img className="thumb" src={assetUrl(src)} alt={alt} />
          </a>
        </span>
      ) : (
        <span style={{ fontSize: width / 3.4, opacity: 0.35 }}>
          <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 24 24' fill='none' stroke='%23a3b8aa' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='18' height='18' x='3' y='3' rx='2' ry='2'/%3E%3Ccircle cx='9' cy='9' r='2'/%3E%3Cpath d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'/%3E%3C/svg%3E" style={{ width: 30, height: 30 }} alt="" />
        </span>
      )}
    </span>
  );
}

export function AvatarCell({ src, name, size = 40 }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size / 2.2, fontWeight: 700 }}>
      {src ? <img className="thumb" src={assetUrl(src)} alt={name} /> : initial}
    </span>
  );
}

export function PdfLink({ url, label = 'Ficha PDF' }) {
  if (!url) return <span className="text-muted" style={{ fontSize: 12 }}>—</span>;
  return (
    <a className="pdf-chip" href={assetUrl(url)} target="_blank" rel="noreferrer">
      <Download size={12} /> {label} <ExternalLink size={11} />
    </a>
  );
}

export function Badge({ kind = 'gray', children }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

export function StatusBadge({ value }) {
  const map = {
    pagado: ['green', 'Pagado'],
    por_pagar: ['red', 'Por pagar'],
    a_cuenta: ['yellow', 'A cuenta'],
  };
  const [kind, label] = map[value] || ['gray', value || '—'];
  return <Badge kind={kind}>{label}</Badge>;
}

export function InvoiceBadge({ type, number }) {
  const pre = { boleta: 'B', factura: 'F', proforma: 'P', cotizacion: 'C' }[type] || 'V';
  const n = number == null ? '----' : String(number).padStart(7, '0');
  return (
    <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, color: 'var(--g-forest)', fontSize: 13 }}>
      {pre}-{n}
    </span>
  );
}

export function DocTypeBadge({ type }) {
  const map = {
    boleta: ['blue', 'Boleta'],
    factura: ['yellow', 'Factura'],
    proforma: ['gray', 'Proforma'],
    cotizacion: ['green', 'Cotización'],
  };
  const [kind, label] = map[type] || ['gray', type || '—'];
  return <Badge kind={kind}>{label}</Badge>;
}

export function fmtMoney(n) {
  const num = Number(n || 0);
  return 'S/ ' + num.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}