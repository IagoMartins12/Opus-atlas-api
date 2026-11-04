import { imslpComposerLink } from './imslp-link';

describe('imslpComposerLink', () => {
  it('usa o link guardado', () => {
    expect(
      imslpComposerLink(
        'https://imslp.org/wiki/Category:Bach,_Johann_Sebastian',
        null,
      ),
    ).toBe('https://imslp.org/wiki/Category:Bach,_Johann_Sebastian');
  });
  it('sem link, monta pela categoria', () => {
    expect(imslpComposerLink(null, 'Category:Satie,_Erik')).toBe(
      'https://imslp.org/wiki/Category:Satie,_Erik',
    );
    expect(imslpComposerLink('', 'Category:Albert (guitarist), Heinrich')).toBe(
      'https://imslp.org/wiki/Category:Albert_(guitarist),_Heinrich',
    );
  });
  it('sem nenhum dos dois, nada', () => {
    expect(imslpComposerLink(null, null)).toBeNull();
    expect(imslpComposerLink(undefined, 'Satie')).toBeNull();
  });
});
