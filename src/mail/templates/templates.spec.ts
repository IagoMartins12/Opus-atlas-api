import { EMAIL_SAMPLES, renderSample } from './samples';

const SITE = 'https://opusatlas.com.br';
const NOW = new Date('2026-10-12T15:00:00Z');

/**
 * The words of every email, in both languages. A change to a text shows up
 * here as a snapshot diff to review; the layout itself has its own tests
 * (`email-layout.spec.ts`).
 */
describe.each(['conta', 'portal', 'cobranca', 'contato', 'newsletter'])(
  'e-mails de %s',
  (group) => {
    const samples = EMAIL_SAMPLES.filter((s) => s.group === group);

    it.each(
      samples.flatMap((s) =>
        (['pt', 'en'] as const).map((l) => [s.id, l, s] as const),
      ),
    )('%s (%s)', (_id, language, sample) => {
      const email = renderSample(sample, language, SITE, NOW);
      expect({ subject: email.subject, text: email.text }).toMatchSnapshot();
      expect(email.html).toContain(
        `lang="${language === 'en' ? 'en-US' : 'pt-BR'}"`,
      );
    });
  },
);

it('cada exemplo tem id único', () => {
  const ids = EMAIL_SAMPLES.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});
