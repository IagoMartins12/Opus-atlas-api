import { isIPv4, isIPv6 } from 'net';

/**
 * IP sem a parte que identifica o aparelho: IPv4 fica com a rede /24 (último
 * octeto zerado) e IPv6 com o prefixo /48.
 *
 * Para a trilha de auditoria, que precisa dizer de onde veio uma ação sem
 * guardar o endereço de uma pessoa. Um resumo (hash) sem segredo não serviria:
 * são só 4 bilhões de IPv4, e o resumo se desfaz por força bruta.
 */
export function maskIp(ip?: string | null): string | undefined {
  if (!ip) {
    return undefined;
  }

  // IPv4 dentro de IPv6 (`::ffff:203.0.113.45`), como o Node entrega às vezes.
  const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  if (isIPv4(address)) {
    return `${address.split('.').slice(0, 3).join('.')}.0`;
  }

  if (isIPv6(address)) {
    const [head] = address.split('::');
    const groups = head.split(':').filter(Boolean).slice(0, 3);
    return `${groups.join(':')}::`;
  }

  return undefined;
}
