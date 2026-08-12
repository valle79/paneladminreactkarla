export const COMPANY = {
  name: 'FABRICACIÓN & SERVICIOS EL IQUEÑO SAC',
  shortName: 'FABRICACION & SERVICIOS EL IQUEÑO SAC',
  ruc: '20491400294',
  address: 'JR. AUGUSTO B. LEGUIA Nº 523. IMPERIAL - CAÑETE',
  phones: ['958840599', '963792905'],
  emails: ['informes@implementosagricolasfsi.com', 'eliquenosac.lili@gmail.com'],
  bank: {
    name: 'BANCO DE CREDITO DEL PERU',
    account: '255-1983070-0-66',
    type: 'Cuenta corriente en soles',
  },
  seller: {
    name: 'LILI CAICO R.',
    role: 'Área de Ventas y Servicios',
  },
};

export const PROFORMA_DEFAULTS = {
  validez: '30 días útiles luego de recibida su orden de compra',
  formaDePago: '50 % con la orden de compra y el saldo contra entrega',
  entrega: '12 días: en nuestras instalaciones o lo enviamos por transporte Marvisur, paga flete al recoger máquina.',
  moneda: 'En soles',
};

export const DOC_CONF = {
  proforma: { label: 'PROFORMA', suffix: '/FSI SAC' },
  cotizacion: { label: 'COTIZACIÓN', suffix: '/FSI SAC' },
  boleta: { label: 'BOLETA', suffix: '' },
  factura: { label: 'FACTURA', suffix: '' },
};

export function formatDocNumber(type, number) {
  const year = new Date().getFullYear();
  if (type === 'proforma' || type === 'cotizacion') {
    const n = number == null || number === '' ? '____' : String(number).padStart(3, '0');
    const label = DOC_CONF[type].label;
    return `${label} Nº ${n}/${year}/FSI SAC`;
  }
  const n = number == null || number === '' ? '' : String(number).padStart(7, '0');
  return `${DOC_CONF[type].label} Nº ${n}`;
}

export function formatMoneyPLN(n) {
  return Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}