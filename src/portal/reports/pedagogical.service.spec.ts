import { ForbiddenException } from '@nestjs/common';
import { AiTextService } from '../../ai/ai-text.service';
import { RecommendationsService } from '../../catalog/recommendations/recommendations.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PedagogicalService } from './pedagogical.service';
import { ProgressReportService } from './progress-report.service';
import { cleanRatings, skillOf } from './skills';

const overview = {
  completedLessons: 4,
  totalLessons: 4,
  attendanceRate: 100,
  assignmentCompletionRate: 50,
  avgEngagement: 4,
  avgPreparation: 2.5,
} as never;

describe('PedagogicalService', () => {
  let service: PedagogicalService;
  let reports: { hasAdvancedReports: jest.Mock; generate: jest.Mock };
  let ai: { enabled: boolean; complete: jest.Mock };
  let prisma: { work: { findMany: jest.Mock } };

  beforeEach(() => {
    reports = {
      hasAdvancedReports: jest.fn().mockResolvedValue(true),
      generate: jest.fn().mockResolvedValue({
        student: { name: 'Ana Souza' },
        period: { label: 'Último mês' },
        report: {
          overview,
          skills: {
            skills: [
              {
                label: 'Leitura',
                current: 2.5,
                change: null,
                lessons: 3,
                practiceMinutes: 0,
              },
            ],
          },
        },
      }),
    };
    ai = { enabled: true, complete: jest.fn() };
    prisma = { work: { findMany: jest.fn() } };
    service = new PedagogicalService(
      prisma as unknown as PrismaService,
      reports as unknown as ProgressReportService,
      {} as RecommendationsService,
      ai as unknown as AiTextService,
    );
  });

  it('fora do Maestro recusa', async () => {
    reports.hasAdvancedReports.mockResolvedValue(false);
    await expect(service.nextPieces('t', 's')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('usa as dicas da IA quando vêm no formato', async () => {
    ai.complete.mockResolvedValue({
      text: '["Leia 5 minutos à primeira vista por dia.", "Separe as mãos na passagem difícil."]',
      generatedBy: 'anthropic/x',
    });
    const result = await service.draftTips('t', 's', {});
    expect(result.generatedBy).toBe('anthropic/x');
    expect(result.tips).toHaveLength(2);
  });

  it('sem resposta útil da IA, as regras escrevem apoiadas nos números', async () => {
    ai.complete.mockResolvedValue({ text: 'não sei', generatedBy: 'x' });
    const result = await service.draftTips('t', 's', {});
    expect(result.generatedBy).toBe('rules');
    expect(result.tips.join(' ')).toMatch(/Leitura/);
    expect(result.tips.join(' ')).toMatch(/tarefas/);
  });

  it('peças aprovadas: só as que existem, sem repetir, com a nota do professor', async () => {
    prisma.work.findMany.mockResolvedValue([
      { id: 'w1', title: 'Noturno', composer: { name: 'Chopin' } },
    ]);
    const pieces = await service.approvedPieces([
      { workId: 'w1', note: '  Para o recital ' },
      { workId: 'w1' },
      { workId: 'w404' },
    ]);
    expect(pieces).toEqual([
      {
        workId: 'w1',
        title: 'Noturno',
        composer: 'Chopin',
        note: 'Para o recital',
      },
    ]);
  });

  it('dicas limpas: sem vazias nem repetidas', () => {
    expect(service.cleanTips(['A', ' a ', '', 'B'])).toEqual(['A', 'B']);
  });
});

describe('habilidades', () => {
  it('lê o tema livre pela palavra-chave', () => {
    expect(skillOf('Escalas maiores')).toBe('technique');
    expect(skillOf('Leitura à primeira vista')).toBe('reading');
    expect(skillOf('Noturno op. 9')).toBeNull();
  });

  it('descarta nota fora da lista ou fora de 1–5', () => {
    expect(
      cleanRatings({ technique: 4, reading: 7, foo: 3, memory: 2.5 }),
    ).toEqual({ technique: 4 });
  });
});
