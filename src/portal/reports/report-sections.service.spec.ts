import { Test, TestingModule } from '@nestjs/testing';
import { AssignmentStatus, LessonStatus } from '@prisma/client';
import { resolvePeriod } from './report-period';
import {
  AssignmentFact,
  LearnedFact,
  LessonFact,
  ReportInput,
  ReportSectionsService,
} from './report-sections.service';

const at = (iso: string) => new Date(iso);

const lesson = (over: Partial<LessonFact> = {}): LessonFact => ({
  id: `l-${Math.random()}`,
  status: LessonStatus.COMPLETED,
  scheduledAt: at('2026-03-10T19:00:00.000Z'),
  duration: 60,
  engagement: null,
  preparation: null,
  punctuality: null,
  topics: [],
  techniques: [],
  challenges: [],
  improvements: [],
  skillsWorked: [],
  studentPresent: true,
  ...over,
});

const assignment = (over: Partial<AssignmentFact> = {}): AssignmentFact => ({
  id: `a-${Math.random()}`,
  type: 'practice',
  status: AssignmentStatus.COMPLETED,
  isCompleted: true,
  dueDate: at('2026-03-20T00:00:00.000Z'),
  completedAt: at('2026-03-18T00:00:00.000Z'),
  createdAt: at('2026-03-10T00:00:00.000Z'),
  estimatedTime: 60,
  actualTime: 60,
  teacherRating: null,
  studentRating: null,
  ...over,
});

const learnedWork = (over: Partial<LearnedFact> = {}): LearnedFact => ({
  learnedAt: at('2026-03-15T00:00:00.000Z'),
  mastery: 80,
  wouldRecommend: true,
  workId: `w-${Math.random()}`,
  workTitle: 'Sonata',
  composerName: 'Beethoven',
  difficulty: '5',
  ...over,
});

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  lessons: [],
  assignments: [],
  learned: [],
  wantToLearn: [],
  period: resolvePeriod({
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-06-30T00:00:00.000Z',
  }),
  ...over,
});

describe('ReportSectionsService', () => {
  let service: ReportSectionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportSectionsService],
    }).compile();

    service = module.get(ReportSectionsService);
  });

  // -----------------------------------------------------------------
  describe('overview', () => {
    // O legado devolvia 100 de presença para quem não tinha aula nenhuma.
    it('taxa sem amostra é nula, não cem', () => {
      const result = service.overview(input());

      expect(result.attendanceRate).toBeNull();
      expect(result.assignmentCompletionRate).toBeNull();
      expect(result.avgEngagement).toBeNull();
    });

    it('presença conta só aula que aconteceu', () => {
      const result = service.overview(
        input({
          lessons: [
            lesson({ status: LessonStatus.COMPLETED }),
            lesson({ status: LessonStatus.COMPLETED }),
            lesson({ status: LessonStatus.COMPLETED }),
            lesson({ status: LessonStatus.NO_SHOW }),
            lesson({ status: LessonStatus.SCHEDULED }),
            lesson({ status: LessonStatus.CANCELLED }),
          ],
        }),
      );

      expect(result.attendanceRate).toBe(75);
      expect(result.totalLessons).toBe(6);
    });

    it('soma minutos só de aula concluída', () => {
      const result = service.overview(
        input({
          lessons: [
            lesson({ status: LessonStatus.COMPLETED, duration: 90 }),
            lesson({ status: LessonStatus.SCHEDULED, duration: 60 }),
          ],
        }),
      );

      expect(result.lessonMinutes).toBe(90);
    });

    it('média de engajamento ignora aula sem nota', () => {
      const result = service.overview(
        input({
          lessons: [
            lesson({ engagement: 5 }),
            lesson({ engagement: 3 }),
            lesson({ engagement: null }),
          ],
        }),
      );

      expect(result.avgEngagement).toBe(4);
    });
  });

  // -----------------------------------------------------------------
  describe('tarefas', () => {
    // No legado, `difficultyRating` era `Math.round(Math.random() * 5) + 1`.
    it('dificuldade vem da nota do aluno, não de sorteio', () => {
      const result = service.assignments(
        input({
          assignments: [
            assignment({ studentRating: 4 }),
            assignment({ studentRating: 2 }),
          ],
        }),
      );

      expect(result.byType[0].difficultyRating).toBe(3);
    });

    it('dificuldade é nula quando o aluno não registrou', () => {
      const result = service.assignments(
        input({ assignments: [assignment({ studentRating: null })] }),
      );

      expect(result.byType[0].difficultyRating).toBeNull();
    });

    it('mede pontualidade só onde havia prazo e entrega', () => {
      const result = service.assignments(
        input({
          assignments: [
            assignment({
              dueDate: at('2026-03-20T00:00:00.000Z'),
              completedAt: at('2026-03-18T00:00:00.000Z'),
            }),
            assignment({
              dueDate: at('2026-03-20T00:00:00.000Z'),
              completedAt: at('2026-03-25T00:00:00.000Z'),
            }),
            assignment({ dueDate: null, completedAt: null }),
          ],
        }),
      );

      expect(result.punctualityRate).toBe(50);
    });

    it('razão de tempo compara real com estimado', () => {
      const result = service.assignments(
        input({
          assignments: [assignment({ estimatedTime: 60, actualTime: 90 })],
        }),
      );

      expect(result.byType[0].timeRatio).toBe(1.5);
    });
  });

  // -----------------------------------------------------------------
  describe('repertório', () => {
    // No legado, `satisfactionRate` era `Math.random() * 30 + 70` — nunca podia
    // indicar insatisfação.
    it('satisfação vem de `wouldRecommend`', () => {
      const result = service.repertoire(
        input({
          learned: [
            learnedWork({ wouldRecommend: true }),
            learnedWork({ wouldRecommend: false }),
            learnedWork({ wouldRecommend: false }),
            learnedWork({ wouldRecommend: false }),
          ],
        }),
      );

      expect(result.satisfactionRate).toBe(25);
    });

    it('satisfação é nula sem obra aprendida', () => {
      expect(service.repertoire(input()).satisfactionRate).toBeNull();
    });

    it('agrupa por compositor', () => {
      const result = service.repertoire(
        input({
          learned: [
            learnedWork({ composerName: 'Bach' }),
            learnedWork({ composerName: 'Bach' }),
            learnedWork({ composerName: 'Chopin' }),
          ],
        }),
      );

      expect(result.topComposers[0]).toEqual({ composer: 'Bach', count: 2 });
    });
  });

  // -----------------------------------------------------------------
  describe('engajamento', () => {
    // No legado, `preferenceScore` era `Math.round(Math.random() * 100)`.
    it('pontuação do tópico vem do engajamento das aulas dele', () => {
      const result = service.engagement(
        input({
          lessons: [
            lesson({ topics: ['Escalas'], engagement: 5 }),
            lesson({ topics: ['Escalas'], engagement: 5 }),
            lesson({ topics: ['Leitura'], engagement: 1 }),
          ],
        }),
      );

      const escalas = result.topics.find((t) => t.tag === 'Escalas');
      const leitura = result.topics.find((t) => t.tag === 'Leitura');

      expect(escalas?.preferenceScore).toBe(100);
      expect(leitura?.preferenceScore).toBe(0);
    });

    // Não ter medida é diferente de ter medido zero.
    it('pontuação é nula quando nenhuma aula teve engajamento anotado', () => {
      const result = service.engagement(
        input({ lessons: [lesson({ topics: ['Escalas'], engagement: null })] }),
      );

      expect(result.topics[0].preferenceScore).toBeNull();
      expect(result.topics[0].lessons).toBe(1);
    });

    it('agrupa por dia da semana', () => {
      const result = service.engagement(
        input({
          lessons: [lesson({ scheduledAt: at('2026-03-10T19:00:00.000Z') })],
        }),
      );

      expect(result.byWeekday).toHaveLength(7);
      expect(result.byWeekday.reduce((sum, day) => sum + day.lessons, 0)).toBe(
        1,
      );
    });
  });

  // -----------------------------------------------------------------
  describe('presença mês a mês', () => {
    it('separa por mês e calcula a tendência', () => {
      const result = service.attendance(
        input({
          lessons: [
            lesson({
              scheduledAt: at('2026-01-10T19:00:00.000Z'),
              status: LessonStatus.NO_SHOW,
            }),
            lesson({
              scheduledAt: at('2026-01-17T19:00:00.000Z'),
              status: LessonStatus.COMPLETED,
            }),
            lesson({
              scheduledAt: at('2026-03-10T19:00:00.000Z'),
              status: LessonStatus.COMPLETED,
            }),
          ],
        }),
      );

      expect(result.months).toHaveLength(2);
      expect(result.months[0].attendanceRate).toBe(50);
      expect(result.months[1].attendanceRate).toBe(100);
      expect(result.trend).toBe(50);
    });

    it('tendência é nula com um mês só', () => {
      const result = service.attendance(input({ lessons: [lesson()] }));

      expect(result.trend).toBeNull();
    });

    it('ignora aula agendada e cancelada', () => {
      const result = service.attendance(
        input({
          lessons: [
            lesson({ status: LessonStatus.SCHEDULED }),
            lesson({ status: LessonStatus.CANCELLED }),
          ],
        }),
      );

      expect(result.months).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------
  describe('leitura pedagógica', () => {
    it('cada sinal traz o número que o sustenta', () => {
      const result = service.insights(
        input({
          lessons: [
            lesson({ status: LessonStatus.COMPLETED }),
            lesson({ status: LessonStatus.NO_SHOW }),
            lesson({ status: LessonStatus.NO_SHOW }),
          ],
        }),
      );

      const sinal = result.signals.find((s) => s.kind === 'attendance_low');

      expect(sinal).toBeDefined();
      expect(sinal?.value).toBeCloseTo(33.3, 1);
    });

    it('não emite sinal sem amostra', () => {
      const result = service.insights(input());

      expect(result.signals).toEqual([]);
      expect(result.sampleSize).toBe(0);
    });

    it('conta os pontos fortes mais citados', () => {
      const result = service.insights(
        input({
          lessons: [
            lesson({ improvements: ['Articulação', 'Ritmo'] }),
            lesson({ improvements: ['Articulação'] }),
          ],
        }),
      );

      expect(result.strengths[0]).toEqual({ item: 'Articulação', count: 2 });
    });
  });

  // -----------------------------------------------------------------
  describe('comparação com o período anterior', () => {
    it('não inventa variação quando falta um dos lados', () => {
      const atual = service.overview(input({ lessons: [lesson()] }));
      const anterior = service.overview(input());

      const result = service.comparison(atual, anterior);

      expect(result.change.attendanceRate).toBeNull();
      expect(result.change.completedLessons).toBe(1);
    });
  });
});
