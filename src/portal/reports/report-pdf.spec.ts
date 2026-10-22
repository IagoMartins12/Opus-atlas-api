import { writeFileSync } from 'node:fs';
import { buildReportPdf } from './report-pdf';

describe('buildReportPdf', () => {
  it('gera um PDF com o retrato gravado, peças e dicas', async () => {
    const pdf = await buildReportPdf({
      title: 'Relatório de outubro — Ana',
      studentName: 'Ana Souza',
      teacherName: 'Marina Lopes',
      periodLabel: 'Último mês',
      teacherMessage: 'Ótimo mês. Seguimos no Chopin.',
      reportData: {
        overview: {
          completedLessons: 4,
          totalLessons: 4,
          attendanceRate: 100,
          lessonMinutes: 240,
          completedAssignments: 3,
          totalAssignments: 4,
          avgEngagement: 4.5,
          avgPreparation: 3,
          worksLearned: 1,
        },
        skills: {
          skills: [
            {
              label: 'Técnica',
              current: 4,
              change: 1,
              lessons: 4,
              practiceMinutes: 90,
            },
            {
              label: 'Leitura',
              current: null,
              change: null,
              lessons: 1,
              practiceMinutes: 0,
            },
          ],
        },
        insights: {
          strengths: [{ item: 'Fraseado', count: 2 }],
          challenges: [],
        },
      },
      nextPieces: [
        {
          title: 'Noturno op. 9 nº 2',
          composer: 'Chopin',
          note: 'Para o recital',
        },
      ],
      tips: ['Leia 5 minutos à primeira vista por dia.'],
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, pdf);
  });
});
