import {
  checkOccurrence,
  isPhysicalPlace,
  suggestSlots,
  weekStartOf,
  worstSeverity,
  type BusyLesson,
  type CheckContext,
} from './schedule-rules';

// "Agora" é quinta, 1º de outubro de 2026, 14h20 em São Paulo (17h20 UTC).
const NOW = new Date('2026-10-01T17:20:00Z');
const TZ = 'America/Sao_Paulo';

/** Um instante a partir da hora local de São Paulo (UTC−3, sem horário de verão). */
const at = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00-03:00`);

const lesson = (
  over: Partial<BusyLesson> & { scheduledAt: Date },
): BusyLesson => ({
  id: over.id ?? `l-${over.scheduledAt.toISOString()}`,
  title: 'Aula',
  duration: 60,
  location: 'Estúdio',
  teacherId: 'teacher',
  studentId: 'other-student',
  studentName: 'Júlia',
  teacherName: 'Helena Duarte',
  ...over,
});

const context = (over: Partial<CheckContext> = {}): CheckContext => ({
  now: NOW,
  busy: [],
  rules: {
    teacherId: 'teacher',
    timeZone: TZ,
    bufferMinutes: 15,
    travelMinutes: 40,
    maxLessonsPerDay: null,
    maxLessonsPerWeek: null,
    // Seg a sex, 14h às 20h.
    weekly: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      startTime: '14:00',
      endTime: '20:00',
    })),
    blocks: [],
  },
  plan: {
    studentId: 'marina',
    studentName: 'Marina',
    maxLessonsPerWeek: null,
    preferredDays: [],
  },
  ...over,
});

const proposal = (
  ymd: string,
  hhmm: string,
  location: string | null = 'Estúdio',
) => ({
  scheduledAt: at(ymd, hhmm),
  duration: 60,
  location,
});

const codes = (
  ctx: CheckContext,
  ymd: string,
  hhmm: string,
  location?: string | null,
) => checkOccurrence(proposal(ymd, hhmm, location), ctx).map((f) => f.code);

describe('regras de agenda', () => {
  it('horário livre dentro do atendimento não tem achado', () => {
    expect(codes(context(), '2026-10-08', '15:00')).toEqual([]);
  });

  it('aula no passado impede, e é o único achado', () => {
    const findings = checkOccurrence(
      proposal('2026-10-01', '10:00'),
      context(),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'PAST', severity: 'blocking' });
  });

  it('choque com outra aula do professor é conflito', () => {
    const ctx = context({
      busy: [lesson({ scheduledAt: at('2026-10-08', '15:30') })],
    });
    const findings = checkOccurrence(proposal('2026-10-08', '15:00'), ctx);
    expect(findings[0]).toMatchObject({
      code: 'TEACHER_CLASH',
      severity: 'conflict',
    });
    expect(findings[0].message).toContain('Júlia');
  });

  // A verificação antiga não via a agenda do aluno com outro professor.
  it('choque com a aula do aluno em outra turma é conflito', () => {
    const ctx = context({
      busy: [
        lesson({
          scheduledAt: at('2026-10-08', '15:00'),
          teacherId: 'paulo',
          studentId: 'marina',
          teacherName: 'Paulo Mendes',
        }),
      ],
    });
    const findings = checkOccurrence(proposal('2026-10-08', '15:00'), ctx);
    expect(findings[0]).toMatchObject({
      code: 'STUDENT_CLASH',
      severity: 'conflict',
    });
    expect(findings[0].message).toContain('Paulo Mendes');
  });

  it('aula encostada no fim de outra não é choque', () => {
    const ctx = context({
      busy: [lesson({ scheduledAt: at('2026-10-08', '14:00') })],
    });
    expect(codes(ctx, '2026-10-08', '15:00')).not.toContain('TEACHER_CLASH');
  });

  it('ignora a própria aula na remarcação', () => {
    const ctx = context({
      busy: [lesson({ id: 'me', scheduledAt: at('2026-10-08', '15:00') })],
      excludeLessonId: 'me',
    });
    expect(codes(ctx, '2026-10-08', '15:00')).toEqual([]);
  });

  it('bloqueio declarado é conflito, com o motivo', () => {
    const ctx = context();
    ctx.rules.blocks = [
      {
        start: at('2026-10-12', '00:00'),
        end: at('2026-10-17', '00:00'),
        reason: 'Congresso em Curitiba',
      },
    ];
    const findings = checkOccurrence(proposal('2026-10-14', '15:00'), ctx);
    expect(findings[0]).toMatchObject({
      code: 'TEACHER_BLOCKED',
      severity: 'conflict',
    });
    expect(findings[0].message).toContain('Congresso');
  });

  it('folga menor que a do esquema é aviso', () => {
    const ctx = context({
      busy: [lesson({ scheduledAt: at('2026-10-08', '14:00') })],
    });
    // A anterior termina às 15h; a nova começa às 15h05.
    expect(codes(ctx, '2026-10-08', '15:05')).toContain('BUFFER');
  });

  it('mudar de lugar sem tempo de deslocamento é aviso', () => {
    const ctx = context({
      busy: [
        lesson({
          scheduledAt: at('2026-10-08', '14:00'),
          location: 'Casa do aluno',
        }),
      ],
    });
    const result = codes(ctx, '2026-10-08', '15:20', 'Estúdio');
    expect(result).toContain('TRAVEL');
    expect(result).not.toContain('BUFFER');
  });

  it('aula online não tem deslocamento', () => {
    const ctx = context({
      busy: [
        lesson({
          scheduledAt: at('2026-10-08', '14:00'),
          location: 'Casa do aluno',
        }),
      ],
    });
    expect(codes(ctx, '2026-10-08', '15:20', 'Online — Google Meet')).toEqual(
      [],
    );
  });

  it('fora do atendimento é aviso, não conflito', () => {
    const findings = checkOccurrence(
      proposal('2026-10-10', '10:00'),
      context(),
    ); // sábado
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'OUTSIDE_AVAILABILITY',
        severity: 'warning',
      }),
    ]);
  });

  it('limite de aulas do dia é aviso', () => {
    const ctx = context({
      busy: [
        lesson({ scheduledAt: at('2026-10-08', '14:00') }),
        lesson({ scheduledAt: at('2026-10-08', '18:00') }),
      ],
    });
    ctx.rules.maxLessonsPerDay = 2;
    expect(codes(ctx, '2026-10-08', '16:00')).toContain('DAY_LIMIT');
  });

  it('plano do aluno e dia preferido só avisam', () => {
    const ctx = context({
      busy: [
        lesson({ scheduledAt: at('2026-10-05', '15:00'), studentId: 'marina' }),
      ],
      plan: {
        studentId: 'marina',
        studentName: 'Marina',
        maxLessonsPerWeek: 1,
        preferredDays: ['thursday'],
      },
    });
    const findings = checkOccurrence(proposal('2026-10-06', '15:00'), ctx);
    expect(findings.map((f) => f.code).sort()).toEqual([
      'STUDENT_PREFERRED_DAY',
      'STUDENT_WEEK_PLAN',
    ]);
    expect(worstSeverity(findings)).toBe('warning');
  });

  it('peso maior: conflito vence aviso', () => {
    expect(
      worstSeverity([
        { code: 'BUFFER', severity: 'warning', message: '' },
        { code: 'TEACHER_CLASH', severity: 'conflict', message: '' },
      ]),
    ).toBe('conflict');
    expect(worstSeverity([])).toBe('ok');
  });

  it('a semana começa no domingo, no fuso do professor', () => {
    // Sábado 23h30 em São Paulo já é domingo em UTC.
    expect(weekStartOf(at('2026-10-10', '23:30'), TZ)).toBe('2026-10-04');
    expect(weekStartOf(at('2026-10-11', '00:30'), TZ)).toBe('2026-10-11');
  });

  it('reconhece lugar físico', () => {
    expect(isPhysicalPlace('Estúdio')).toBe(true);
    expect(isPhysicalPlace('Online')).toBe(false);
    expect(isPhysicalPlace('Zoom')).toBe(false);
    expect(isPhysicalPlace(null)).toBe(false);
  });

  describe('sugestões', () => {
    it('pulam os horários com conflito e dão um por dia', () => {
      const ctx = context({
        busy: [lesson({ scheduledAt: at('2026-10-08', '14:00') })],
      });
      const slots = suggestSlots(
        { duration: 60, location: 'Estúdio' },
        ctx,
        at('2026-10-08', '00:00'),
        { limit: 3 },
      );
      // Quinta: 14h ocupado e 15h sem folga → 15h30. Depois sexta e segunda, às 14h.
      expect(slots.map((d) => d.toISOString())).toEqual([
        at('2026-10-08', '15:30').toISOString(),
        at('2026-10-09', '14:00').toISOString(),
        at('2026-10-12', '14:00').toISOString(),
      ]);
    });

    it('não sugerem antes de agora', () => {
      const slots = suggestSlots(
        { duration: 60, location: 'Estúdio' },
        context(),
        at('2026-10-01', '00:00'),
        { limit: 1 },
      );
      expect(slots[0].getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    });

    it('o plano do aluno não tira um horário das sugestões', () => {
      const ctx = context({
        busy: [
          lesson({
            scheduledAt: at('2026-10-05', '15:00'),
            studentId: 'marina',
          }),
        ],
        plan: {
          studentId: 'marina',
          studentName: 'Marina',
          maxLessonsPerWeek: 1,
          preferredDays: [],
        },
      });
      const slots = suggestSlots(
        { duration: 60, location: 'Estúdio' },
        ctx,
        at('2026-10-06', '00:00'),
        { limit: 1 },
      );
      expect(slots[0].toISOString()).toBe(
        at('2026-10-06', '14:00').toISOString(),
      );
    });
  });
});
