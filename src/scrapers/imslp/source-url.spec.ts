import { BadRequestException } from '@nestjs/common';
import { isExternalSource, requireSourceUrl } from './source-url';

describe('requireSourceUrl', () => {
  it('aceita o IMSLP', () => {
    expect(
      requireSourceUrl('https://imslp.org/wiki/Category:Bach,_Johann'),
    ).toMatchObject({ source: 'imslp' });
  });

  it('aceita a Wikipedia em qualquer idioma', () => {
    expect(requireSourceUrl('https://pt.wikipedia.org/wiki/Bach').source).toBe(
      'wikipedia',
    );
    expect(requireSourceUrl('https://en.wikipedia.org/wiki/Bach').source).toBe(
      'wikipedia',
    );
  });

  // O legado validava com `url.includes('imslp.org')` — um `includes` sobre a
  // URL inteira, não sobre o host. Cada um destes passava, e a rota não tinha
  // autenticação nenhuma: SSRF aberto para a internet.
  describe('endereços que o `includes` do legado aceitava', () => {
    const enganosos = [
      'https://169.254.169.254/latest/meta-data/?x=imslp.org',
      'https://servidor-interno:8080/admin#imslp.org',
      'https://imslp.org.dominio-do-atacante.com/',
      'https://dominio-do-atacante.com/imslp.org',
      'https://dominio-do-atacante.com/?ref=pt.wikipedia.org',
    ];

    for (const url of enganosos) {
      it(`recusa ${url}`, () => {
        expect(() => requireSourceUrl(url)).toThrow(BadRequestException);
      });
    }
  });

  it('recusa esquema que não é HTTPS', () => {
    expect(() => requireSourceUrl('http://imslp.org/wiki/x')).toThrow(/HTTPS/);
    expect(() => requireSourceUrl('file:///etc/passwd')).toThrow();
  });

  // Endereço com credencial embutida engana a leitura humana e não tem uso
  // legítimo aqui.
  it('recusa credencial embutida', () => {
    expect(() =>
      requireSourceUrl('https://user:senha@imslp.org/wiki/x'),
    ).toThrow(/credencial/);
  });

  it('recusa URL malformada', () => {
    expect(() => requireSourceUrl('nem é uma url')).toThrow(/URL inválida/);
  });

  it('acusa quando a fonte informada não bate com o endereço', () => {
    expect(() =>
      requireSourceUrl('https://imslp.org/wiki/x', 'wikipedia'),
    ).toThrow(/Wikipedia/);
  });

  // O que é buscado tem de ser exatamente o que foi validado.
  it('devolve a URL normalizada pelo próprio parser', () => {
    expect(requireSourceUrl('https://IMSLP.org/wiki/Bach').url).toBe(
      'https://imslp.org/wiki/Bach',
    );
  });
});

describe('isExternalSource', () => {
  it('reconhece as fontes conhecidas', () => {
    expect(isExternalSource('imslp')).toBe(true);
    expect(isExternalSource('wikipedia')).toBe(true);
    expect(isExternalSource('qualquer-coisa')).toBe(false);
  });
});
