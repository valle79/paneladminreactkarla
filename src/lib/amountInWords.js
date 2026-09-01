/* ============================================================
   Importe numérico a letras en español (Perú).
   Soporta soles y dólares con céntimos.
   ============================================================ */

const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const DECENAS = [
  '', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA',
  'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA',
];
const ESPECIALES = [
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
];

function dosDigitos(n) {
  n = Math.floor(n);
  if (n < 10) return UNIDADES[n];
  if (n >= 10 && n < 20) return ESPECIALES[n - 10];
  const d = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? DECENAS[d] : `${DECENAS[d]} Y ${UNIDADES[u]}`;
}

function tresDigitos(n) {
  n = Math.floor(n);
  if (n < 100) return dosDigitos(n);
  const c = Math.floor(n / 100);
  const resto = n % 100;
  
  // Centenas especiales
  let centena;
  if (c === 1) {
    centena = resto === 0 ? 'CIEN' : 'CIENTO';
  } else if (c === 5) {
    centena = 'QUINIENTOS';
  } else if (c === 7) {
    centena = 'SETECIENTOS';
  } else if (c === 9) {
    centena = 'NOVECIENTOS';
  } else {
    centena = `${UNIDADES[c]}CIENTOS`;
  }
  
  return resto === 0 ? centena : `${centena} ${dosDigitos(resto)}`;
}

function miles(n, moneda) {
  n = Math.floor(n);
  if (n < 1000) return tresDigitos(n);
  const m = Math.floor(n / 1000);
  const r = n % 1000;
  if (m === 1) return r === 0 ? 'MIL' : `MIL ${tresDigitos(r)}`;
  const mWord = m < 1000 ? tresDigitos(m) : null;
  if (mWord) return r === 0 ? `${mWord} MIL` : `${mWord} MIL ${tresDigitos(r)}`;
  return formatWord(n, moneda);
}

function formatWord(n, moneda) {
  const millones = Math.floor(n / 1000000);
  const resto = n % 1000000;
  const millionPart = millones === 1 ? 'UN MILLÓN' : `${miles(millones, moneda)} MILLONES`;
  const restStr = miles(resto, moneda);
  if (millones > 0) {
    return resto === 0 ? millionPart : `${millionPart} CON ${restStr}`;
  }
  return miles(resto, moneda);
}

export function amountInWords(value, { currency = 'SOLES' } = {}) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 'CERO';
  const isNegative = num < 0;
  const abs = Math.abs(num);
  const entero = Math.floor(abs);
  const centimos = Math.round((abs - entero) * 100);
  const intWord = entero === 0 ? 'CERO' : formatWord(entero, currency);
  const moneda = currency === 'DÓLARES' ? 'DOLARES AMERICANOS' : 'SOLES';
  return `${isNegative ? 'MENOS ' : ''}${intWord} CON ${String(centimos).padStart(2, '0')}/100 ${moneda}`;
}
