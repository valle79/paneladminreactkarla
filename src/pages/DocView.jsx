import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import Icon from '../components/Icon';
import { api } from '../api';
import { COMPANY } from '../config';
import { ProformaDocument } from '../components/Proforma';
import logoElIqueno from '../images/Logo-El-Iqueño.png';

export default function DocView() {
  const { saleId, token } = useParams();
  const printRef = useRef(null);
  const [sale, setSale] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSale(null);
    setFailed(false);
    api.get(`/public-doc/${saleId}/${token}`)
      .then((r) => { if (alive) setSale(r.data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [saleId, token]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: sale ? `${sale.invoice_type}-${sale.invoice_number}` : 'documento',
    pageStyle: '@page { size: A4 portrait; margin: 10mm; }',
  });

  return (
    <div className="docview">
      <header className="docview-bar">
        <div className="docview-brand">
          <img src={logoElIqueno} alt="El Iqueño" className="docview-logo" />
          <div>
            <div className="docview-name">{COMPANY.shortName}</div>
            <div className="docview-sub">Documento digital oficial</div>
          </div>
        </div>
        {sale && (
          <button className="btn btn-yellow" onClick={handlePrint}>
            <Icon name="print" size={15} /> Descargar PDF / Imprimir
          </button>
        )}
      </header>

      <main className="docview-stage">
        {failed ? (
          <div className="docview-empty">
            <Icon name="document" size={42} />
            <h2>Documento no disponible</h2>
            <p>El enlace es inválido, expiró o el documento fue anulado.</p>
            <p className="docview-contact">
              Para asistencia: {COMPANY.phones.map((p) => `+51 ${p}`).join(' / ')}
            </p>
          </div>
        ) : !sale ? (
          <div className="docview-empty">
            <span className="spinner lg" />
            <p>Cargando documento...</p>
          </div>
        ) : (
          <div className="proforma-preview">
            <ProformaDocument
              ref={printRef}
              sale={{ ...sale, advisor_name: sale.advisor_name || sale.advisor?.name }}
            />
          </div>
        )}
      </main>

      <footer className="docview-foot">
        Documento generado por el sistema de {COMPANY.name} · RUC {COMPANY.ruc}
      </footer>
    </div>
  );
}