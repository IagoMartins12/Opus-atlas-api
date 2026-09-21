/** Porta `parsePhoneNumber` de `Classical-Music/src/app/actions/profile.ts`. */
const COUNTRY_CODE_MAP: Record<string, string> = {
  '1': 'US',
  '55': 'BR',
  '44': 'GB',
  '33': 'FR',
  '49': 'DE',
  '39': 'IT',
  '34': 'ES',
  '7': 'RU',
  '81': 'JP',
  '86': 'CN',
  '91': 'IN',
  '61': 'AU',
  '52': 'MX',
  '54': 'AR',
  '56': 'CL',
  '57': 'CO',
};

/** Os códigos conhecidos, do mais longo ao mais curto. */
const KNOWN_CODES = Object.keys(COUNTRY_CODE_MAP).sort(
  (left, right) => right.length - left.length,
);

/**
 * Separa o código do país do número.
 *
 * **Corrige um defeito do legado.** Ele fazia `^\+(\d{1,4})`, que é guloso: em
 * `+5581999990000` — o formato mais comum de gravar — tomava "5581" como código
 * do país. O Brasil virava desconhecido e o DDD sumia do número
 * (`999990000`). Só passava quando havia um espaço depois do código.
 *
 * Agora casa o código conhecido mais longo que prefixa os dígitos. Código
 * desconhecido fica `null`, e o número guarda todos os dígitos — nada se perde.
 */
export function parsePhoneNumber(phone: string): {
  phoneCountryCode: string | null;
  phoneNumber: string | null;
} {
  if (!phone || !phone.startsWith('+')) {
    return { phoneCountryCode: null, phoneNumber: null };
  }

  const digits = phone.replace(/\D/g, '');

  if (!digits) {
    return { phoneCountryCode: null, phoneNumber: null };
  }

  const code = KNOWN_CODES.find((known) => digits.startsWith(known));

  return code
    ? {
        phoneCountryCode: COUNTRY_CODE_MAP[code],
        phoneNumber: digits.slice(code.length),
      }
    : { phoneCountryCode: null, phoneNumber: digits };
}
