import { NotificationType } from '@prisma/client';
import { offsetMinutes } from '../../common/utils/time-zone';

/**
 * Por onde cada aviso do portal sai, além do próprio portal (04/10/2026).
 *
 * A pessoa não escolhe tipo a tipo (são 30 tipos técnicos): escolhe por
 * **tema**, em palavras dela — "aula começando", "mudança de aula". Cada tema
 * tem um padrão; o que a pessoa marcar fica em `User.notificationChannels`.
 * O portal recebe sempre. SMS é guardado como escolha, mas ainda não sai.
 */

export type Channel = 'email' | 'sms';
export type Audience = 'teacher' | 'student' | 'both';

export interface Topic {
  key: string;
  label: string;
  audience: Audience;
  types: NotificationType[];
  defaults: Record<Channel, boolean>;
}

export const TOPICS: Topic[] = [
  {
    key: 'lesson-reminder',
    label: 'Aula começando',
    audience: 'both',
    types: [
      NotificationType.LESSON_STARTING_SOON,
      NotificationType.LESSON_TOMORROW,
    ],
    defaults: { email: true, sms: false },
  },
  {
    key: 'lesson-change',
    label: 'Aula marcada, remarcada ou cancelada',
    audience: 'student',
    types: [
      NotificationType.NEW_LESSON_SCHEDULED,
      NotificationType.LESSON_RESCHEDULED_BY_TEACHER,
      NotificationType.LESSON_CANCELLED_BY_TEACHER,
      NotificationType.LESSON_MARKED_NO_SHOW,
    ],
    defaults: { email: true, sms: false },
  },
  {
    key: 'lesson-request',
    label: 'Pedidos de aula',
    audience: 'both',
    types: [
      NotificationType.LESSON_REQUESTED,
      NotificationType.LESSON_REQUEST_ACCEPTED,
      NotificationType.LESSON_REQUEST_DECLINED,
      NotificationType.STUDENT_REQUESTED_RESCHEDULE,
    ],
    defaults: { email: true, sms: false },
  },
  {
    key: 'absence',
    label: 'Aluno avisou falta',
    audience: 'teacher',
    types: [NotificationType.STUDENT_INFORMED_ABSENCE],
    defaults: { email: true, sms: false },
  },
  {
    key: 'assignment',
    label: 'Tarefas e retornos',
    audience: 'both',
    types: [
      NotificationType.NEW_ASSIGNMENT_CREATED,
      NotificationType.ASSIGNMENT_UPDATED_BY_TEACHER,
      NotificationType.ASSIGNMENT_DUE_TOMORROW,
      NotificationType.ASSIGNMENT_OVERDUE,
      NotificationType.TEACHER_GAVE_FEEDBACK,
      NotificationType.STUDENT_SUBMITTED_ASSIGNMENT,
      NotificationType.STUDENT_COMPLETED_ASSIGNMENT,
    ],
    defaults: { email: false, sms: false },
  },
  {
    key: 'report',
    label: 'Relatórios e comentários',
    audience: 'both',
    types: [
      NotificationType.PROGRESS_REPORT_SHARED,
      NotificationType.WEEKLY_REPORT_AVAILABLE,
    ],
    defaults: { email: false, sms: false },
  },
  {
    key: 'announcement',
    label: 'Recados do professor',
    audience: 'student',
    types: [
      NotificationType.TEACHER_ANNOUNCEMENT,
      NotificationType.WORK_SUGGESTED,
      NotificationType.STUDENT_ADDED_BY_TEACHER,
    ],
    defaults: { email: true, sms: false },
  },
];

const TOPIC_OF_TYPE = new Map(
  TOPICS.flatMap((t) => t.types.map((type) => [type, t] as const)),
);

export const topicOf = (type: NotificationType) =>
  TOPIC_OF_TYPE.get(type) ?? null;

export type ChannelPreferences = Record<
  string,
  Partial<Record<Channel, boolean>>
>;

/** As escolhas guardadas por cima dos padrões, tema a tema. */
export function resolvePreferences(
  stored: unknown,
): Record<string, Record<Channel, boolean>> {
  const saved = (
    stored && typeof stored === 'object' ? stored : {}
  ) as ChannelPreferences;
  return Object.fromEntries(
    TOPICS.map((t) => [
      t.key,
      {
        email: saved[t.key]?.email ?? t.defaults.email,
        sms: saved[t.key]?.sms ?? t.defaults.sms,
      },
    ]),
  );
}

/** "22:00" → 1320. */
const minutesOfDay = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Se `now` cai no horário de silêncio, quando ele acaba; senão, `null`.
 * O silêncio pode atravessar a meia-noite (22:00 às 07:00).
 */
export function quietUntil(
  now: Date,
  quiet: { start?: string | null; end?: string | null },
  timeZone: string,
): Date | null {
  if (!quiet.start || !quiet.end || quiet.start === quiet.end) return null;
  const offset = offsetMinutes(now.getTime(), timeZone);
  const localMinutes =
    (((now.getUTCHours() * 60 + now.getUTCMinutes() + offset) % 1440) + 1440) %
    1440;
  const start = minutesOfDay(quiet.start);
  const end = minutesOfDay(quiet.end);
  const inside =
    start < end
      ? localMinutes >= start && localMinutes < end
      : localMinutes >= start || localMinutes < end;
  if (!inside) return null;
  const wait = (end - localMinutes + 1440) % 1440;
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000 + wait * 60_000);
}
