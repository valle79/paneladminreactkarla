import { forwardRef, useRef, useState, useEffect } from 'react';
import { Printer, Eye, CheckCircle2, X } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import { Modal } from './Modal';
import { COMPANY, PROFORMA_DEFAULTS, formatDocNumber, formatMoneyPLN } from '../config';
import logoElIqueno from '../images/Logo-El-Iqueño.png';

/* ============================================================
   ProformaDocument: el documento imprimible (A4)
   ============================================================ */

const DocFooter = ({ page = 1 }) => (
  <div className="proforma-footer">
    <div className="proforma-footer-row">{COMPANY.footer.thanks}</div>
    <div className="proforma-footer-row">{COMPANY.footer.tagline}</div>
    <div className="proforma-footer-row proforma-footer-contact">{COMPANY.footer.contact}</div>
    <div className="proforma-footer-page">Página {page}</div>
  </div>
);

export const ProformaDocument = forwardRef(function ProformaDocument({ sale, options, documentTime }, ref) {
  const o = { ...PROFORMA_DEFAULTS, ...options };
  const isProformaLike = sale.invoice_type === 'proforma' || sale.invoice_type === 'cotizacion';
  const client = sale.client || {};
  const clienteLinea = client.names
    ? `${client.names} ${client.last_names || ''}`
    : client.razonsocial || '—';
  const docRuc = client.ruc || client.dni || '—';

  const now = documentTime || new Date();
  const fechaDoc = sale.fecha
    ? String(sale.fecha).slice(0, 10).split('-').reverse().join('/')
    : now.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaDoc = now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });

  const sub = Number(sale.subtotal || 0);
  const igv = Number(sale.igv || 0);
  const total = Number(sale.total || 0);

  const imgBase = typeof window !== 'undefined' ? window.location.origin : '';
  const absImg = (u) => (u && /^https?:\/\//.test(u) ? u : imgBase + u);
  const itemsConFoto = (sale.items || []).filter((it) => it.image_url);

  const descriptionLine = (item) => {
    if (item.is_manual) {
      return item.manual_description ? <span style={{ color: '#444' }}>{item.manual_description}</span> : null;
    }
    const specCount = (item.specifications || []).length;
    const featCount = (item.features || []).length;
    return (
      <ul style={{ margin: '4px 0 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55, color: '#444' }}>
        {(item.specifications || []).map((s, i) => (
          <li key={'s' + i}>{s.label}: {s.value}</li>
        ))}
        {(item.features || []).map((f, i) => (
          <li key={'f' + i}>{f}</li>
        ))}
        {item.description && !specCount && !featCount ? <li>{item.description}</li> : null}
      </ul>
    );
  };

  return (
    <div className="proforma-page" ref={ref}>
      {/* Primera página - contenido principal */}
      <div className="proforma-main-page">
        {/* Doble línea de corte clásica */}
        <div className="proforma-rule" />

        {/* Encabezado */}
        <div className="proforma-head">
          <div className="proforma-brand">
            <div className="proforma-name">{COMPANY.name}</div>
            <div className="proforma-meta">
              RUC: <b>{COMPANY.ruc}</b> · {COMPANY.address}
            </div>
            <div className="proforma-contacts">
              <span>✉ {COMPANY.emails.join(' / ')}</span>
              <span>☎ {COMPANY.phones.join(' / ')}</span>
            </div>
          </div>
          <img src={logoElIqueno} alt="El Iqueño" className="proforma-logo" />
        </div>
        <div className="proforma-doc">
          <div className="proforma-doc-number">
            {formatDocNumber(sale.invoice_type, sale.invoice_number)}
          </div>
          <div className="proforma-doc-date">
            FECHA: <b>{fechaDoc}</b>
            <span className="proforma-doc-time">HORA: <b>{horaDoc}</b></span>
          </div>
        </div>

        {/* Cliente */}
        <div className="proforma-client">
          <div className="proforma-client-col">
            <div className="proforma-client-label">SEÑORES:</div>
            <div className="proforma-client-value">{clienteLinea}</div>
          </div>
          <div className="proforma-client-col">
            <div className="proforma-client-label">{client.dni ? 'DNI' : 'RUC'}:</div>
            <div className="proforma-client-value">{docRuc}</div>
          </div>
          <div className="proforma-client-col">
            <div className="proforma-client-label">ATENCIÓN:</div>
            <div className="proforma-client-value">{sale.advisor_name || '—'}</div>
          </div>
          <div className="proforma-client-col">
            <div className="proforma-client-label">DIRECCIÓN:</div>
            <div className="proforma-client-value">{client.address || client.direccion || '—'}</div>
          </div>
        </div>

        {/* Tabla de items */}
        <table className="proforma-table">
          <thead>
            <tr>
              <th className="pt-cant">CANT.</th>
              <th>DESCRIPCIÓN</th>
              <th className="pt-price">P. UNIT.</th>
              <th className="pt-price">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {(sale.items || []).map((item, i) => (
              <tr key={i}>
                <td className="pt-cant" style={{ textAlign: 'center' }}>{item.quantity}</td>
                <td>
                  <div className="pt-item-name">{item.name}</div>
                  {descriptionLine(item)}
                </td>
                <td className="pt-price money">{formatMoneyPLN(item.unit_price)}</td>
                <td className="pt-price money"><b>{formatMoneyPLN(Number(item.quantity || 0) * Number(item.unit_price || 0))}</b></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totales */}
        <div className="proforma-totals">
          <div className="proforma-totals-left">
            {!isProformaLike && <div className="proforma-total-note">MONEDA: {o.moneda}</div>}
          </div>
          <div className="proforma-totals-right">
            <div className="pt-line"><span>VALOR DE VENTA</span><b>{formatMoneyPLN(sub)}</b></div>
            <div className="pt-line"><span>IGV (18%)</span><b>{formatMoneyPLN(igv)}</b></div>
            <div className="pt-line pt-line-total"><span>PRECIO DE VENTA</span><b>{formatMoneyPLN(total)}</b></div>
          </div>
        </div>

        {isProformaLike && (
          <>
            {/* Condiciones */}
            <div className="proforma-cond">
              <table className="proforma-cond-table">
                <tbody>
                  <tr>
                    <td className="pc-label">MONEDA</td>
                    <td className="pc-value"><b>:</b> {o.moneda}</td>
                  </tr>
                  <tr>
                    <td className="pc-label">VALIDEZ</td>
                    <td className="pc-value"><b>:</b> {o.validez}</td>
                  </tr>
                  <tr>
                    <td className="pc-label">FORMA DE PAGO</td>
                    <td className="pc-value"><b>:</b> {o.formaDePago}</td>
                  </tr>
                  <tr>
                    <td className="pc-label">ENTREGA</td>
                    <td className="pc-value"><b>:</b> {o.entrega}</td>
                  </tr>
                  <tr>
                    <td className="pc-label">CUENTA</td>
                    <td className="pc-value"><b>:</b> {COMPANY.bank.name}: <b>{COMPANY.bank.account}</b> ({COMPANY.bank.type})</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Carta */}
            <div className="proforma-letter">
              <p style={{ margin: 0 }}>
                <b>ESTIMADOS SEÑORES:</b> En atención a su solicitud, nos es grato entregarle la siguiente propuesta.
              </p>
              <p style={{ margin: '6px 0 0 0' }}>
                De aceptada nuestra oferta, agradeceremos emitir su grata orden de compra a nombre de{' '}
                <b>{COMPANY.shortName}</b> para su pronta atención.
              </p>
            </div>

            {/* Firma */}
            <div className="proforma-sign">
              <div className="proforma-sign-col">
                <div className="proforma-sign-left-label">ATENTAMENTE</div>
              </div>
              <div className="proforma-sign-col">
                <div className="proforma-sign-line" />
                <div className="proforma-sign-name">{COMPANY.seller.name}</div>
                <div className="proforma-sign-role">{COMPANY.seller.role}</div>
                <div className="proforma-sign-company">{COMPANY.shortName}</div>
              </div>
            </div>
          </>
        )}

        {!isProformaLike && (
          <div className="proforma-sign">
            <div className="proforma-sign-col">
              <div className="proforma-sign-left-label">ATENTAMENTE</div>
            </div>
            <div className="proforma-sign-col">
              <div className="proforma-sign-line" />
              <div className="proforma-sign-name">{COMPANY.seller.name}</div>
              <div className="proforma-sign-role">{COMPANY.seller.role}</div>
              <div className="proforma-sign-company">{COMPANY.shortName}</div>
            </div>
          </div>
        )}

        <div className="proforma-doc-foot">
          <DocFooter page={1} />
        </div>
      </div>

      {/* Fotos de referencia (siguiente hoja) */}
      {itemsConFoto.length > 0 && (
        <div className="proforma-photos">
          <div className="proforma-photos-content">
            <div className="proforma-photos-title">Fotos de referencia</div>
            <div className="proforma-photos-grid">
              {itemsConFoto.map((item, i) => (
                <div className="proforma-photo-card" key={i}>
                  <img src={absImg(item.image_url)} alt={item.name} />
                  <div className="proforma-photo-name">{item.name}</div>
                  <div className="proforma-photo-tag">Foto referencial</div>
                </div>
              ))}
            </div>
            <div className="proforma-photos-note">
              Las imágenes mostradas son referenciales; el producto final puede variar ligeramente según modelo y versión.
            </div>
          </div>
          <div className="proforma-doc-foot">
            <DocFooter page={2} />
          </div>
        </div>
      )}
    </div>
  );
});

/* ============================================================
   ProformaModal: vista previa + confirmar + imprimir
   ============================================================ */

export default function ProformaModal({ open, onClose, sale, onConfirm, confirmText = 'Confirmar y registrar' }) {
  const printRef = useRef(null);
  const [opts, setOpts] = useState({ ...PROFORMA_DEFAULTS });
  const [busy, setBusy] = useState(false);
  const [documentTime, setDocumentTime] = useState(() => new Date());
  const isProformaLike = sale?.invoice_type === 'proforma' || sale?.invoice_type === 'cotizacion';

  useEffect(() => {
    if (open) {
      setOpts({ ...PROFORMA_DEFAULTS });
      setDocumentTime(new Date());
    }
  }, [open]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Proforma-${sale?.invoice_number || 'preview'}`,
    pageStyle: '@page { size: A4 portrait; margin: 10mm; }',
    onBeforeGetContent: () => new Promise((resolve) => {
      setDocumentTime(new Date());
      resolve();
    }),
  });

  const wrappedSale = sale && { ...sale, advisor_name: sale.advisor_name || sale.advisor?.name };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isProformaLike ? 'Vista previa de proforma' : 'Vista previa de documento'}
      icon={<Eye size={18} />}
      size="xl"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}><X size={15} /> Cerrar</button>
          <button className="btn btn-yellow" onClick={handlePrint}><Printer size={15} /> Imprimir / PDF</button>
          {onConfirm && (
            <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}>
              {busy ? <span className="spinner" /> : <CheckCircle2 size={16} />} {confirmText}
            </button>
          )}
        </>
      }
    >
      {sale && (
        <>
          {isProformaLike && (
            <div className="proforma-editable" style={{ marginBottom: 14 }}>
              <div className="grid-3">
                <div className="field">
                  <label>Moneda</label>
                  <input className="input" value={opts.moneda} onChange={(e) => setOpts({ ...opts, moneda: e.target.value })} />
                </div>
                <div className="field">
                  <label>Validez</label>
                  <input className="input" value={opts.validez} onChange={(e) => setOpts({ ...opts, validez: e.target.value })} />
                </div>
                <div className="field">
                  <label>Forma de pago</label>
                  <input className="input" value={opts.formaDePago} onChange={(e) => setOpts({ ...opts, formaDePago: e.target.value })} />
                </div>
                <div className="field" style={{ gridColumn: 'span 3' }}>
                  <label>Entrega</label>
                  <input className="input" value={opts.entrega} onChange={(e) => setOpts({ ...opts, entrega: e.target.value })} />
                </div>
              </div>
            </div>
          )}
          <div className="proforma-preview">
            <ProformaDocument ref={printRef} sale={wrappedSale} options={opts} documentTime={documentTime} />
          </div>
        </>
      )}
    </Modal>
  );
}