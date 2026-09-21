import { maskIp } from './ip-mask';

describe('maskIp', () => {
  it('IPv4 fica com a rede /24', () => {
    expect(maskIp('203.0.113.45')).toBe('203.0.113.0');
  });

  it('IPv4 dentro de IPv6 também', () => {
    expect(maskIp('::ffff:198.51.100.7')).toBe('198.51.100.0');
  });

  it('IPv6 fica com o prefixo /48', () => {
    expect(maskIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe(
      '2001:db8:85a3::',
    );
    expect(maskIp('2001:db8::1')).toBe('2001:db8::');
  });

  it('vazio ou inválido não grava nada', () => {
    expect(maskIp(undefined)).toBeUndefined();
    expect(maskIp('')).toBeUndefined();
    expect(maskIp('não é ip')).toBeUndefined();
  });
});
