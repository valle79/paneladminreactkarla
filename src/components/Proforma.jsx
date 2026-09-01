import { forwardRef, useRef, useState, useEffect } from 'react';
import Icon from './Icon';
import { useReactToPrint } from 'react-to-print';
import { Modal } from './Modal';
import { COMPANY, PROFORMA_DEFAULTS, formatDocNumber, formatMoneyPLN, moneySymbol } from '../config';
import { API_URL } from '../api';
import { amountInWords } from '../lib/amountInWords';
import logoElIqueno from '../images/Logo-El-Iqueño.png';

/* ============================================================
   ProformaDocument: documento imprimible (A4) corporativo
   ============================================================ */

const DocFooter = ({ page = 1, total = 1 }) => (
  <div className="proforma-footer">
    <div className="proforma-footer-block">
      <div className="proforma-footer-name">{COMPANY.name}</div>
      <div className="proforma-footer-row">
        RUC: {COMPANY.ruc} · {COMPANY.address}
      </div>
      <div className="proforma-footer-row proforma-footer-contact">
        Tel: {COMPANY.phones.join(' / ')} · Email: {COMPANY.contact?.ventas || COMPANY.emails[0]}
      </div>
    </div>
    <div className="proforma-footer-page">Página {page} de {total}</div>
  </div>
);

/* Barra superior del documento con identidad + numeración */
function DocHeader({ sale, fechaDoc, horaDoc, fechaPago }) {
  const docTypeLabel = sale.invoice_type === 'proforma' ? 'PROFORMA' :
                       sale.invoice_type === 'cotizacion' ? 'COTIZACIÓN' :
                       sale.invoice_type === 'boleta' ? 'BOLETA DE VENTA' : 'FACTURA';
  
  return (
    <>
      <div className="proforma-head">
        <img src={logoElIqueno} alt="El Iqueño" className="proforma-logo" />
        <div className="proforma-brand">
          <div className="proforma-name">{COMPANY.name}</div>
          <div className="proforma-meta">{COMPANY.address}</div>
          <div className="proforma-meta">Teléfono: {COMPANY.phones.join(' / ')}</div>
          <div className="proforma-meta">Email: {COMPANY.emails[0]}</div>
          <div className="proforma-meta">Web: www.implementosagricolasfsi.com</div>
        </div>
        <div className="proforma-doc-box">
          <div className="proforma-doc-box-label">R.U.C. N° {COMPANY.ruc}</div>
          <div className="proforma-doc-box-type">{docTypeLabel}</div>
          <div className="proforma-doc-box-number">
            {String(sale.invoice_number || '').padStart(4, '0')}-{new Date().getFullYear().toString().slice(-2)}-{COMPANY.ruc.slice(-4)}
          </div>
        </div>
      </div>
      <div className="proforma-rule" />
    </>
  );
}

/* Bloque de datos del cliente y condiciones juntos */
function DocClientAndConditions({ client, docRuc, clienteLinea, sale, o, isProformaLike }) {
  const muestraDireccion = client.address || client.direccion || '—';
  return (
    <div className="proforma-client-conditions-wrapper">
      {/* Información del cliente (izquierda) */}
      <div className="proforma-client-box">
        <div className="proforma-client-title">DATOS DEL CLIENTE:</div>
        <div className="proforma-client-simple">
          <div className="proforma-client-line">
            <span className="pc-label">Razón Social/Nombre</span>
            <span className="pc-sep">:</span>
            <span className="pc-value">{clienteLinea}</span>
          </div>
          <div className="proforma-client-line">
            <span className="pc-label">{client.dni ? 'DNI' : 'RUC'}</span>
            <span className="pc-sep">:</span>
            <span className="pc-value">{docRuc}</span>
          </div>
          <div className="proforma-client-line">
            <span className="pc-label">Dirección</span>
            <span className="pc-sep">:</span>
            <span className="pc-value">{muestraDireccion}</span>
          </div>
          <div className="proforma-client-line">
            <span className="pc-label">Fecha de Emisión</span>
            <span className="pc-sep">:</span>
            <span className="pc-value">{sale.fecha ? String(sale.fecha).slice(0, 10).split('-').reverse().join('/') : new Date().toLocaleDateString('es-PE')}</span>
          </div>
          <div className="proforma-client-line">
            <span className="pc-label">Atención</span>
            <span className="pc-sep">:</span>
            <span className="pc-value">{sale.advisor_name || '—'}</span>
          </div>
        </div>
      </div>

      {/* Condiciones comerciales (derecha) */}
      {isProformaLike && (
        <div className="proforma-conditions-box">
          <div className="proforma-conditions-title">CONDICIONES:</div>
          <div className="proforma-cond-simple">
            <div className="proforma-cond-line">
              <span className="pc-label">Moneda</span>
              <span className="pc-sep">:</span>
              <span className="pc-value">{o.moneda}</span>
            </div>
            <div className="proforma-cond-line">
              <span className="pc-label">Validez</span>
              <span className="pc-sep">:</span>
              <span className="pc-value">{o.validez}</span>
            </div>
            <div className="proforma-cond-line">
              <span className="pc-label">Forma de pago</span>
              <span className="pc-sep">:</span>
              <span className="pc-value">{o.formaDePago}</span>
            </div>
            <div className="proforma-cond-line">
              <span className="pc-label">Entrega</span>
              <span className="pc-sep">:</span>
              <span className="pc-value">{o.entrega}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Condiciones comerciales (deprecado - ahora se muestra con el cliente) */
function DocConditions({ o, isProformaLike }) {
  return null;
}

/* Tabla de items */
function DocItems({ items, symbol }) {
  return (
    <div className="proforma-items-box">
      <table className="proforma-table">
        <thead>
          <tr>
            <th className="pt-item">Ítem</th>
            <th className="pt-cant">Cant.</th>
            <th className="pt-desc">Descripción</th>
            <th className="pt-price">P. unitario</th>
            <th className="pt-price">Total</th>
          </tr>
        </thead>
        <tbody>
          {(items || []).map((item, i) => (
            <tr key={i}>
              <td className="pt-item num">{String(i + 1).padStart(2, '0')}</td>
              <td className="pt-cant num">{item.quantity}</td>
              <td>
                <div className="pt-item-name">{item.name}</div>
                {descriptionLine(item)}
              </td>
              <td className="pt-price money">{symbol} {formatMoneyPLN(item.unit_price)}</td>
              <td className="pt-price money total">
                <b>{symbol} {formatMoneyPLN(Number(item.quantity || 0) * Number(item.unit_price || 0))}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function descriptionLine(item) {
  if (item.is_manual) {
    return item.manual_description ? <div className="pt-item-desc">{item.manual_description}</div> : null;
  }
  const hasList = (item.specifications || []).length || (item.features || []).length;
  const withNewlines = typeof item.description === 'string' && /\r|\n/.test(item.description);
  if (withNewlines) {
    return <div className="pt-item-desc">{item.description}</div>;
  }
  if (!hasList && item.description) {
    return <div className="pt-item-desc">{item.description}</div>;
  }
  if (!hasList) return null;
  return (
    <ul className="pt-item-list">
      {(item.specifications || []).map((s, i) => (
        <li key={'s' + i}><b>{s.label}:</b> {s.value}</li>
      ))}
      {(item.features || []).map((f, i) => (
        <li key={'f' + i}>{f}</li>
      ))}
    </ul>
  );
}

/* Totales */
function DocTotals({ sub, igv, total, symbol, o, isProformaLike }) {
  const igvRate = sub > 0 ? Math.round((igv / sub) * 100) : 0;
  const igvLabel = igvRate > 0 ? `IGV (${igvRate}%)` : 'IGV';
  return (
    <div className="proforma-totals">
      <div className="proforma-totals-left">
        {isProformaLike && <div className="proforma-total-note">MONEDA: {o.moneda}</div>}
        <div className="proforma-total-inwords">
          SON: {amountInWords(total, { currency: /dolar|usd/i.test(o.moneda || '') ? 'DÓLARES' : 'SOLES' })}
        </div>
      </div>
      <div className="proforma-totals-right">
        <div className="pt-line"><span>VALOR DE VENTA</span><b>{symbol} {formatMoneyPLN(sub)}</b></div>
        <div className="pt-line"><span>{igvLabel}</span><b>{symbol} {formatMoneyPLN(igv)}</b></div>
        <div className="pt-line pt-line-total"><span>PRECIO DE VENTA</span><b>{symbol} {formatMoneyPLN(total)}</b></div>
      </div>
    </div>
  );
}

/* Información bancaria */
function DocBank({ o, isProformaLike }) {
  if (!isProformaLike) return null;
  return (
    <div className="proforma-bank">
      <div className="proforma-bank-title">INFORMACIÓN BANCARIA</div>
      {(COMPANY.bankAccounts || [COMPANY.bank]).map((acc, i) => (
        <div className="proforma-bank-row" key={i}>
          <span><b>{acc.bank}</b></span>
          <span>Cuenta: <b>{acc.account}</b></span>
          <span>Moneda: <b>{acc.currency || 'Soles'}</b></span>
        </div>
      ))}
    </div>
  );
}

/* Mensaje comercial */
function DocMessage({ isProformaLike }) {
  if (!isProformaLike) return null;
  return (
    <div className="proforma-letter">
      <p className="proforma-letter-greet">Estimados señores:</p>
      <p className="proforma-letter-body">{COMPANY.commercial.intro}</p>
      <p className="proforma-letter-body">{COMPANY.commercial.closing}</p>
    </div>
  );
}

/* Firma */
function DocSignature({ sale }) {
  const sellerName = sale.advisor?.name
    ? sale.advisor.name
    : COMPANY.seller.name;
  return (
    <div className="proforma-sign">
      <div className="proforma-sign-note">
        <div className="proforma-sign-left-label">Atentamente,</div>
        <div className="proforma-sign-phone">{COMPANY.phones.join(' / ')}</div>
      </div>
      <div className="proforma-sign-col">
        <div className="proforma-sign-line" />
        <div className="proforma-sign-name">{sellerName}</div>
        <div className="proforma-sign-role">{COMPANY.seller.role}</div>
        <div className="proforma-sign-company">{COMPANY.name}</div>
        <div className="proforma-sign-email">{COMPANY.seller.email || COMPANY.emails[0]}</div>
      </div>
    </div>
  );
}

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
  const fechaPago = sale.payment_date
    ? String(sale.payment_date).slice(0, 10).split('-').reverse().join('/')
    : null;

  const sub = Number(sale.subtotal || 0);
  const igv = Number(sale.igv || 0);
  const total = Number(sale.total || 0);

  const symbol = moneySymbol(o.moneda);
  const absImg = (u) => (u && /^https?:\/\//.test(u) ? u : API_URL + u);
  const itemsConFoto = (sale.items || []).filter((it) => it.image_url);

  const pagesTotal = itemsConFoto.length > 0 ? 2 : 1;

  return (
    <div className="proforma-page" ref={ref}>
      {/* Primera página - contenido principal */}
      <div className="proforma-main-page">
        <div className="proforma-wf">
          <DocHeader sale={sale} fechaDoc={fechaDoc} horaDoc={horaDoc} fechaPago={fechaPago} />
          <DocClientAndConditions client={client} docRuc={docRuc} clienteLinea={clienteLinea} sale={sale} o={o} isProformaLike={isProformaLike} />
          <DocItems items={sale.items} symbol={symbol} />
          <DocTotals sub={sub} igv={igv} total={total} symbol={symbol} o={o} isProformaLike={isProformaLike} />
          <DocBank o={o} isProformaLike={isProformaLike} />
          <DocMessage isProformaLike={isProformaLike} />
          <DocSignature sale={sale} />
        </div>
        <div className="proforma-doc-foot">
          <DocFooter page={1} total={pagesTotal} />
        </div>
      </div>

      {/* Fotos de referencia (siguiente hoja) */}
      {itemsConFoto.length > 0 && (
        <div className="proforma-photos">
          <div className="proforma-photos-content">
            <div className="proforma-photos-header">
              <div className="proforma-photos-title">IMÁGENES REFERENCIALES DEL PRODUCTO</div>
              <div className="proforma-photos-subtitle">Especificaciones técnicas y visuales</div>
            </div>
            <div className="proforma-photos-grid">
              {itemsConFoto.map((item, i) => (
                <div className="proforma-photo-card" key={i}>
                  <div className="proforma-photo-frame">
                    <img src={absImg(item.image_url)} alt={item.name} />
                  </div>
                  <div className="proforma-photo-info">
                    <div className="proforma-photo-name">{item.name}</div>
                    {item.description && (
                      <div className="proforma-photo-desc">{item.description}</div>
                    )}
                    <div className="proforma-photo-details">
                      <span className="photo-detail-item">
                        <strong>Cantidad:</strong> {item.quantity} {item.quantity > 1 ? 'unidades' : 'unidad'}
                      </span>
                      <span className="photo-detail-item">
                        <strong>P. Unit:</strong> {symbol} {formatMoneyPLN(item.unit_price)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="proforma-photos-disclaimer">
              <div className="disclaimer-icon">ℹ️</div>
              <div className="disclaimer-text">
                <strong>Nota importante:</strong> Las imágenes mostradas son de carácter referencial. 
                El producto final puede presentar variaciones en color, acabado o accesorios según 
                el modelo, marca y versión específica disponible al momento de la entrega.
              </div>
            </div>
          </div>
          <div className="proforma-doc-foot">
            <DocFooter page={2} total={pagesTotal} />
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
  const docLabel = ({ boleta: 'Boleta', factura: 'Factura', proforma: 'Proforma', cotizacion: 'Cotizacion' })[sale?.invoice_type] || 'Documento';

  useEffect(() => {
    if (open) {
      setOpts({ ...PROFORMA_DEFAULTS });
      setDocumentTime(new Date());
    }
  }, [open]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `${docLabel}-${sale?.invoice_number || 'preview'}`,
    pageStyle: '@page { size: A4 portrait; margin: 8mm; }',
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
      icon={<Icon name="visible" size={18} />}
      size="xl"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}><Icon name="x" size={15} /> Cerrar</button>
          <button className="btn btn-yellow" onClick={handlePrint}><Icon name="print" size={15} /> Imprimir / PDF</button>
          {onConfirm && (
            <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}>
              {busy ? <span className="spinner" /> : <Icon name="checkmark--v1" size={16} />} {confirmText}
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
