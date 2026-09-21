import { escapeHtml } from './html.util';

describe('escapeHtml', () => {
  it('neutraliza marcação e aspas', () => {
    expect(escapeHtml('<a href="x">Clique</a> & \'oi\'')).toBe(
      '&lt;a href=&quot;x&quot;&gt;Clique&lt;/a&gt; &amp; &#39;oi&#39;',
    );
  });

  it('nulo e número viram texto', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(3)).toBe('3');
  });
});
