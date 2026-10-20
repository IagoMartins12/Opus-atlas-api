import { localDate } from '../../common/utils/time-zone';
import {
  expandWeekly,
  type Interval,
  type WeeklySlot,
} from '../availability/free-slots';

/**
 * Regras de agenda do portal — funções puras, sem banco.
 *
 * **A regra do produto é "a agenda informa, não impede"** (Regras do portal).
 * Por isso cada achado tem um peso, e só um deles barra a marcação:
 *
 * - `blocking`: impossível (aula no passado). Nem `force` resolve.
 * - `conflict`: duas coisas no mesmo lugar do tempo — choque com outra aula do
 *   professor, com outra aula do aluno (em qualquer turma) ou um bloqueio
 *   declarado. Marcar exige confirmação explícita (`force`).
 * - `warning`: dá para marcar, mas vale saber — folga curta, deslocamento,
 *   fora do atendimento, limites do dia e da semana, plano do aluno.
 *
 * O serviço (`ScheduleRulesService`) carrega o que a série inteira precisa
 * numa leva de consultas e chama estas funções para cada ocorrência.
 */

export type FindingSeverity = 'blocking' | 'conflict' | 'warning';

export type FindingCode =
  | 'PAST'
  | 'TEACHER_BLOCKED'
  | 'TEACHER_CLASH'
  | 'STUDENT_CLASH'
  | 'BUFFER'
  | 'TRAVEL'
  | 'OUTSIDE_AVAILABILITY'
  | 'DAY_LIMIT'
  | 'WEEK_LIMIT'
  | 'STUDENT_WEEK_PLAN'
  | 'STUDENT_PREFERRED_DAY';

export interface Finding {
  code: FindingCode;
  severity: FindingSeverity;
  message: string;
  /** A aula envolvida, quando houver (choque, folga, deslocamento). */
  lessonId?: string;
}

/** Uma aula que já ocupa a agenda de alguém. */
export interface BusyLesson {
  id: string;
  title: string;
  scheduledAt: Date;
  duration: number;
  location: string | null;
  teacherId: string;
  studentId: string;
  /** Nome do aluno (para a frase do achado). */
  studentName: string | null;
  /** Nome do professor, quando a aula é de outra turma do aluno. */
  teacherName: string | null;
}

export interface TeacherRules {
  teacherId: string;
  timeZone: string;
  bufferMinutes: number;
  travelMinutes: number;
  maxLessonsPerDay: number | null;
  maxLessonsPerWeek: number | null;
  weekly: WeeklySlot[];
  blocks: Array<Interval & { reason: string | null }>;
}

export interface StudentPlan {
  studentId: string;
  studentName: string;
  maxLessonsPerWeek: number | null;
  /** "monday", "thursday"… como guardado no vínculo. */
  preferredDays: string[];
}

export interface CheckContext {
  rules: TeacherRules;
  plan: StudentPlan;
  /** Aulas do professor e do aluno (qualquer turma) na janela da série. */
  busy: BusyLesson[];
  now: Date;
  /** Remarcação: a própria aula não conta. */
  excludeLessonId?: string;
}

export interface Proposal {
  scheduledAt: Date;
  duration: number;
  location: string | null;
}

const MINUTE = 60_000;
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
const WEEKDAYS_PT = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
];

const endOf = (l: { scheduledAt: Date; duration: number }) =>
  new Date(l.scheduledAt.getTime() + l.duration * MINUTE);

const overlaps = (a: Interval, b: Interval) =>
  a.start < b.end && b.start < a.end;

/** Online não tem lugar físico: entre uma aula online e outra não há trajeto. */
export function isPhysicalPlace(location: string | null): boolean {
  if (!location || !location.trim()) return false;
  return !/online|remot|meet|zoom|skype|teams|v[íi]deo/i.test(location);
}

const samePlace = (a: string | null, b: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

const hhmm = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    hourCycle: 'h23',
  }).format(instant);

const weekdayIn = (instant: Date, timeZone: string) => {
  const [y, m, d] = localDate(instant, timeZone).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** Domingo da semana local da data — a semana do portal começa no domingo. */
export function weekStartOf(instant: Date, timeZone: string): string {
  const ymd = localDate(instant, timeZone);
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const weekday = new Date(utc).getUTCDay();
  return new Date(utc - weekday * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Os achados de uma ocorrência. Ordem: o mais grave primeiro.
 */
export function checkOccurrence(
  proposal: Proposal,
  ctx: CheckContext,
): Finding[] {
  const findings: Finding[] = [];
  const { rules, plan } = ctx;
  const start = proposal.scheduledAt;
  const end = endOf(proposal);
  const tz = rules.timeZone;

  if (start < ctx.now) {
    return [
      {
        code: 'PAST',
        severity: 'blocking',
        message: 'Este horário já passou.',
      },
    ];
  }

  const others = ctx.busy.filter((l) => l.id !== ctx.excludeLessonId);

  // Bloqueios declarados (férias, feriado, viagem).
  for (const block of rules.blocks) {
    if (overlaps({ start, end }, block)) {
      findings.push({
        code: 'TEACHER_BLOCKED',
        severity: 'conflict',
        message: block.reason
          ? `Você bloqueou este período: ${block.reason}.`
          : 'Você bloqueou este período.',
      });
    }
  }

  // Choques: com o professor e com o aluno, em qualquer turma.
  for (const lesson of others) {
    if (
      !overlaps(
        { start, end },
        { start: lesson.scheduledAt, end: endOf(lesson) },
      )
    )
      continue;
    const range = `${hhmm(lesson.scheduledAt, tz)}–${hhmm(endOf(lesson), tz)}`;

    if (lesson.teacherId === rules.teacherId) {
      findings.push({
        code: 'TEACHER_CLASH',
        severity: 'conflict',
        lessonId: lesson.id,
        message: `Choca com a aula de ${lesson.studentName ?? 'outro aluno'} (${range}).`,
      });
    } else if (lesson.studentId === plan.studentId) {
      findings.push({
        code: 'STUDENT_CLASH',
        severity: 'conflict',
        lessonId: lesson.id,
        message: `${plan.studentName} tem aula com ${lesson.teacherName ?? 'outro professor'} neste horário (${range}).`,
      });
    }
  }

  // Folga e deslocamento: só olham as vizinhas do professor, e só quando não
  // há choque — com choque, a frase da folga seria ruído.
  if (!findings.some((f) => f.code === 'TEACHER_CLASH')) {
    const mine = others.filter((l) => l.teacherId === rules.teacherId);
    const before = mine
      .filter((l) => endOf(l) <= start)
      .sort((a, b) => endOf(b).getTime() - endOf(a).getTime())[0];
    const after = mine
      .filter((l) => l.scheduledAt >= end)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];

    for (const [neighbor, gap] of [
      [
        before,
        before
          ? (start.getTime() - endOf(before).getTime()) / MINUTE
          : Infinity,
      ],
      [
        after,
        after
          ? (after.scheduledAt.getTime() - end.getTime()) / MINUTE
          : Infinity,
      ],
    ] as const) {
      if (!neighbor) continue;
      const moves =
        isPhysicalPlace(neighbor.location) &&
        isPhysicalPlace(proposal.location) &&
        !samePlace(neighbor.location, proposal.location);

      if (moves && gap < rules.travelMinutes) {
        findings.push({
          code: 'TRAVEL',
          severity: 'warning',
          lessonId: neighbor.id,
          message: `Sobram ${Math.round(gap)} min para ir de um lugar a outro; você reservou ${rules.travelMinutes}.`,
        });
      } else if (!moves && gap < rules.bufferMinutes) {
        findings.push({
          code: 'BUFFER',
          severity: 'warning',
          lessonId: neighbor.id,
          message: `Só ${Math.round(gap)} min de folga junto da aula de ${neighbor.studentName ?? 'outro aluno'}; seu esquema pede ${rules.bufferMinutes}.`,
        });
      }
    }
  }

  // Atendimento: informa, não impede (uma reposição num sábado é normal).
  if (
    rules.weekly.length > 0 &&
    !findings.some((f) => f.code === 'TEACHER_BLOCKED')
  ) {
    const windows = expandWeekly(
      rules.weekly,
      new Date(start.getTime() - 86_400_000),
      new Date(end.getTime() + 86_400_000),
      tz,
    );
    const inside = windows.some((w) => w.start <= start && end <= w.end);
    if (!inside) {
      findings.push({
        code: 'OUTSIDE_AVAILABILITY',
        severity: 'warning',
        message:
          'Fora do seu horário de atendimento. Dá para marcar assim mesmo.',
      });
    }
  }

  // Limites do dia e da semana do professor.
  const day = localDate(start, tz);
  const week = weekStartOf(start, tz);
  const mineActive = others.filter((l) => l.teacherId === rules.teacherId);
  const sameDay = mineActive.filter(
    (l) => localDate(l.scheduledAt, tz) === day,
  ).length;
  const sameWeek = mineActive.filter(
    (l) => weekStartOf(l.scheduledAt, tz) === week,
  ).length;

  if (rules.maxLessonsPerDay && sameDay >= rules.maxLessonsPerDay) {
    findings.push({
      code: 'DAY_LIMIT',
      severity: 'warning',
      message: `Seria a ${sameDay + 1}ª aula do dia; seu limite é ${rules.maxLessonsPerDay}.`,
    });
  }
  if (rules.maxLessonsPerWeek && sameWeek >= rules.maxLessonsPerWeek) {
    findings.push({
      code: 'WEEK_LIMIT',
      severity: 'warning',
      message: `A semana já tem ${sameWeek} aulas; seu limite é ${rules.maxLessonsPerWeek}.`,
    });
  }

  // O plano de estudos do aluno.
  const studentWeek = others.filter(
    (l) =>
      l.teacherId === rules.teacherId &&
      l.studentId === plan.studentId &&
      weekStartOf(l.scheduledAt, tz) === week,
  ).length;
  if (plan.maxLessonsPerWeek && studentWeek >= plan.maxLessonsPerWeek) {
    findings.push({
      code: 'STUDENT_WEEK_PLAN',
      severity: 'warning',
      message: `${plan.studentName} já tem ${studentWeek} aula${studentWeek > 1 ? 's' : ''} nesta semana; o plano prevê ${plan.maxLessonsPerWeek}.`,
    });
  }
  const weekday = WEEKDAYS[weekdayIn(start, tz)];
  if (plan.preferredDays.length > 0 && !plan.preferredDays.includes(weekday)) {
    findings.push({
      code: 'STUDENT_PREFERRED_DAY',
      severity: 'warning',
      message: `${plan.studentName} prefere ${plan.preferredDays
        .map((d) => WEEKDAYS_PT[WEEKDAYS.indexOf(d)] ?? d)
        .join(' e ')}.`,
    });
  }

  const order: Record<FindingSeverity, number> = {
    blocking: 0,
    conflict: 1,
    warning: 2,
  };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** O peso maior de uma lista de achados (`ok` quando não há nada). */
export function worstSeverity(findings: Finding[]): FindingSeverity | 'ok' {
  if (findings.some((f) => f.severity === 'blocking')) return 'blocking';
  if (findings.some((f) => f.severity === 'conflict')) return 'conflict';
  if (findings.length > 0) return 'warning';
  return 'ok';
}

/**
 * Próximos horários limpos a partir de `from`: dentro do atendimento, sem
 * conflito e sem aviso — fora o plano e a preferência de dia, que só
 * informam e não tiram o horário das sugestões.
 */
export function suggestSlots(
  proposal: Omit<Proposal, 'scheduledAt'>,
  ctx: CheckContext,
  from: Date,
  options: { limit?: number; days?: number; stepMinutes?: number } = {},
): Date[] {
  const limit = options.limit ?? 4;
  const days = options.days ?? 14;
  const step = options.stepMinutes ?? 30;
  const startFrom = from < ctx.now ? ctx.now : from;
  const windows = expandWeekly(
    ctx.rules.weekly,
    startFrom,
    new Date(startFrom.getTime() + days * 86_400_000),
    ctx.rules.timeZone,
  );
  const tolerated = new Set<FindingCode>([
    'STUDENT_WEEK_PLAN',
    'STUDENT_PREFERRED_DAY',
  ]);
  const found: Date[] = [];
  const usedDays = new Set<string>();

  for (const window of windows) {
    const day = localDate(window.start, ctx.rules.timeZone);
    if (usedDays.has(day)) continue;

    // Começa em horário redondo. Arredondar o instante basta: os fusos em
    // uso têm deslocamento em horas cheias ou meias horas.
    let cursor = new Date(
      Math.ceil(window.start.getTime() / (step * MINUTE)) * step * MINUTE,
    );

    while (
      cursor.getTime() + proposal.duration * MINUTE <=
      window.end.getTime()
    ) {
      const findings = checkOccurrence(
        { ...proposal, scheduledAt: cursor },
        ctx,
      );
      if (findings.every((f) => tolerated.has(f.code))) {
        found.push(cursor);
        usedDays.add(day); // Uma sugestão por dia: opções em dias diferentes ajudam mais.
        break;
      }
      cursor = new Date(cursor.getTime() + step * MINUTE);
    }
    if (found.length >= limit) break;
  }
  return found;
}
