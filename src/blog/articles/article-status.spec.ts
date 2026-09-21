import { ArticleStatus } from '@prisma/client';
import {
  ArticleStatusError,
  scheduledPublication,
  statusFields,
  targetOf,
} from './article-status';

const now = new Date('2026-09-10T12:00:00Z');
const yesterday = new Date('2026-09-09T12:00:00Z');
const tomorrow = new Date('2026-09-11T12:00:00Z');

const draft = {
  status: ArticleStatus.DRAFT,
  publishedAt: null,
  scheduledFor: null,
};
const published = {
  status: ArticleStatus.PUBLISHED,
  publishedAt: yesterday,
  scheduledFor: null,
};

describe('statusFields', () => {
  it('publicar um rascunho grava a data de agora', () => {
    expect(statusFields(draft, ArticleStatus.PUBLISHED, null, now)).toEqual({
      status: ArticleStatus.PUBLISHED,
      publishedAt: now,
      scheduledFor: null,
    });
  });

  // O legado regravava a data: republicar levava a matéria ao topo.
  it('publicar de novo um artigo publicado mantém a data dele', () => {
    expect(
      statusFields(published, ArticleStatus.PUBLISHED, null, now).publishedAt,
    ).toBe(yesterday);
  });

  it('agendar grava a data e tira a de publicação', () => {
    expect(
      statusFields(published, ArticleStatus.SCHEDULED, tomorrow, now),
    ).toEqual({
      status: ArticleStatus.SCHEDULED,
      publishedAt: null,
      scheduledFor: tomorrow,
    });
  });

  it('agendar sem data é recusado', () => {
    expect(() =>
      statusFields(draft, ArticleStatus.SCHEDULED, null, now),
    ).toThrow(ArticleStatusError);
  });

  // O legado aceitava, e o artigo ficava SCHEDULED para sempre.
  it('agendar para o passado é recusado', () => {
    expect(() =>
      statusFields(draft, ArticleStatus.SCHEDULED, yesterday, now),
    ).toThrow(/já passou/);
  });

  it('despublicar tira as duas datas', () => {
    expect(statusFields(published, ArticleStatus.DRAFT, null, now)).toEqual({
      status: ArticleStatus.DRAFT,
      publishedAt: null,
      scheduledFor: null,
    });
  });

  it('revisão também tira do ar', () => {
    expect(
      statusFields(published, ArticleStatus.REVIEW, null, now).publishedAt,
    ).toBeNull();
  });

  it('arquivar guarda quando o artigo esteve no ar', () => {
    expect(
      statusFields(published, ArticleStatus.ARCHIVED, null, now).publishedAt,
    ).toBe(yesterday);
  });

  it('artigo novo publicado grava a data de agora', () => {
    expect(
      statusFields(null, ArticleStatus.PUBLISHED, null, now).publishedAt,
    ).toBe(now);
  });
});

describe('scheduledPublication', () => {
  // A varredura roda de minuto em minuto: o atraso dela não pode virar a data.
  it('publica com a data agendada, não com a da varredura', () => {
    expect(scheduledPublication(yesterday)).toEqual({
      status: ArticleStatus.PUBLISHED,
      publishedAt: yesterday,
      scheduledFor: null,
    });
  });
});

describe('targetOf', () => {
  it('traduz as ações do legado', () => {
    expect(targetOf('publish')).toBe(ArticleStatus.PUBLISHED);
    expect(targetOf('unpublish')).toBe(ArticleStatus.DRAFT);
    expect(targetOf('schedule')).toBe(ArticleStatus.SCHEDULED);
  });
});
