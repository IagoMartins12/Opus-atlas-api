import { viewerKey } from './viewer-key';

describe('viewerKey', () => {
  it('logado, é a conta', () => {
    expect(viewerKey({ userId: 'u1', ipAddress: '203.0.113.10' })).toBe('u:u1');
  });

  // O IP cru não é guardado, só o resumo.
  it('anônimo, é um resumo que não contém o IP', () => {
    const key = viewerKey({ ipAddress: '203.0.113.10', userAgent: 'Firefox' });

    expect(key).toMatch(/^a:[0-9a-f]{32}$/);
    expect(key).not.toContain('203.0.113.10');
  });

  it('o mesmo leitor dá sempre a mesma chave', () => {
    const identity = { ipAddress: '203.0.113.10', userAgent: 'Firefox' };

    expect(viewerKey(identity)).toBe(viewerKey(identity));
  });

  it('outro navegador no mesmo IP é outro leitor', () => {
    expect(
      viewerKey({ ipAddress: '203.0.113.10', userAgent: 'Firefox' }),
    ).not.toBe(viewerKey({ ipAddress: '203.0.113.10', userAgent: 'Safari' }));
  });

  it('sem conta nem IP, não há como contar', () => {
    expect(viewerKey({})).toBeNull();
  });
});
