export const COMPANY = {
  name: 'FABRICACIÓN & SERVICIOS EL IQUEÑO SAC',
  shortName: 'FABRICACION & SERVICIOS EL IQUEÑO SAC',
  ruc: '20491400294',
  address: 'JR. AUGUSTO B. LEGUIA Nº 523. IMPERIAL - CAÑETE',
  phones: ['958840599', '963792905'],
  domain: 'eliquenoimplementosagricolas.com',
  emails: [
    'ventas@eliquenoimplementosagricolas.com',
    'karla.a@eliquenoimplementosagricolas.com',
    'lili.c@eliquenoimplementosagricolas.com',
  ],
  contact: {
    general: 'ventas@eliquenoimplementosagricolas.com',
    ventas: 'ventas@eliquenoimplementosagricolas.com',
    karla: 'karla.a@eliquenoimplementosagricolas.com',
    lili: 'lili.c@eliquenoimplementosagricolas.com',
  },
  bank: {
    name: 'Banco de Crédito del Perú – BCP',
    account: '255-1983070-0-66',
    type: 'Cuenta corriente en soles',
    currency: 'Soles',
  },
  bankAccounts: [
    {
      bank: 'Banco de Crédito del Perú – BCP',
      account: '255-1983070-0-66',
      currency: 'Soles',
    },
  ],
  salesTeam: {
    sales: {
      name: 'KARLA A.',
      role: 'Área de Ventas y Servicios',
      email: 'karla.a@eliquenoimplementosagricolas.com',
    },
    admin: {
      name: 'LILI CAICO R.',
      role: 'Administradora',
      email: 'lili.c@eliquenoimplementosagricolas.com',
    },
  },
  seller: {
    name: 'KARLA A.',
    role: 'Área de Ventas y Servicios',
    email: 'karla.a@eliquenoimplementosagricolas.com',
  },
  footer: {
    thanks: 'Gracias por su preferencia, te esperamos pronto.',
    tagline: 'Fabricaciones & Servicios El Iqueño SAC | Calidad y confianza en cada proyecto',
    contact:
      'RUC: 20491400294 | Jr. Augusto B. Leguia Nº 523. Imperial Cañete, Lima - Perú | Tel: +51 958 840 599 | Email: ventas@eliquenoimplementosagricolas.com',
  },
  commercial: {
    intro:
      'En atención a su solicitud, nos es grato entregarle la siguiente propuesta técnica y comercial.',
    closing:
      'De aceptada nuestra oferta, agradeceremos emitir su orden de compra a nombre de nuestra empresa para su pronta atención.',
  },
};

export const MONEDA_LABELS = {
  soles: 'SOLES',
  dolares: 'DÓLARES AMERICANOS',
  usd: 'DÓLARES AMERICANOS',
  pen: 'SOLES',
};

export function moneySymbol(moneda) {
  return /dolar|usd/i.test(moneda || '') ? 'US$' : 'S/';
}

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