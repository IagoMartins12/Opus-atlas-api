import { NotificationPriority, NotificationType } from '@prisma/client';
import { CreateNotificationInput } from './notifications.service';

/**
 * As regras que geram notificação sem ninguém pedir.
 *
 * **No legado elas só existiam se o cliente perguntasse.** As notificações
 * automáticas eram criadas dentro de `POST /notifications/check`, chamada pelo
 * navegador do próprio usuário. Duas consequências:
 *
 * 1. Quem não abrisse o portal não recebia nada — inclusive o aviso de "sua
 *    aula começa em 30 minutos", que é justamente o que só serve *antes* da
 *    aula, e para quem não estava olhando.
 * 2. A condição era uma janela de cinco minutos
 *    (`faltam ≤ 30min && faltam > 25min`). Se a aba estivesse fechada, dormindo
 *    ou o intervalo de sondagem caísse fora, a notificação **nunca era criada**.
 *
 * Aqui a varredura roda no worker, sobre a base inteira, e a janela some: a
 * condição vira "começa nos próximos 30 minutos" e quem impede a repetição é a
 * chave de deduplicação, não a sorte do intervalo.
 */

/** Aulas dentro desta janela geram aviso de "começa logo". */
export const STARTING_SOON_MS = 30 * 60 * 1000;

/** Aulas do dia seguinte, para o aviso de véspera. */
export const TOMORROW_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Tarefas vencendo nas próximas 24h. */
export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

/**
 * Aula que já passou e continua `SCHEDULED` — mas só depois de duas horas, para
 * não cobrar status de uma aula que ainda está acontecendo.
 */
export const NEEDS_STATUS_AFTER_MS = 2 * 60 * 60 * 1000;

/** E até sete dias atrás: cobrar status de aula de um mês atrás é ruído. */
export const NEEDS_STATUS_UNTIL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Chave de deduplicação.
 *
 * **É o que substitui a janela de cinco minutos.** Duas varreduras seguidas
 * produzem a mesma chave para o mesmo aviso, e `notify()` descarta a segunda
 * enquanto a primeira estiver por ler. Assim a varredura pode rodar de cinco em
 * cinco minutos sem transformar um aviso em vinte.
 */
export function notificationHash(
  userId: string,
  type: NotificationType,
  entityId: string,
): string {
  return `${userId}:${type}:${entityId}`;
}

const formatTime = (date: Date): string =>
  date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

const formatDate = (date: Date): string =>
  date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

export interface LessonForNotice {
  id: string;
  title: string;
  scheduledAt: Date;
  teacherUserId: string;
  studentUserId: string;
  teacherName: string;
  studentName: string;
}

export interface AssignmentForNotice {
  id: string;
  title: string;
  dueDate: Date;
  studentUserId: string;
  teacherName: string;
}

export interface InviteForNotice {
  id: string;
  teacherUserId: string;
  studentName: string;
  createdAt: Date;
}

/**
 * Aula prestes a começar — avisa os dois lados.
 *
 * O legado tinha duas rotas separadas gerando o mesmo aviso, uma para cada
 * papel, com textos escritos em lugares diferentes. Aqui a aula é um fato só e
 * gera os dois avisos de uma vez, cada um com o nome da outra pessoa.
 */
export function lessonStartingSoon(
  lesson: LessonForNotice,
): CreateNotificationInput[] {
  const time = formatTime(lesson.scheduledAt);

  const common = {
    type: NotificationType.LESSON_STARTING_SOON,
    priority: NotificationPriority.HIGH,
    relatedEntityType: 'lesson',
    relatedEntityId: lesson.id,
    actionText: 'Ver aula',
    actionUrl: `/portal/aulas/${lesson.id}`,
    // O aviso perde sentido quando a aula termina. Sem prazo, ele ficaria na
    // caixa de entrada depois de a aula já ter acontecido.
    expiresAt: new Date(lesson.scheduledAt.getTime() + STARTING_SOON_MS),
  };

  return [
    {
      ...common,
      userId: lesson.teacherUserId,
      title: 'Sua aula começa em breve',
      message: `Aula com ${lesson.studentName} às ${time}.`,
      uniqueHash: notificationHash(
        lesson.teacherUserId,
        NotificationType.LESSON_STARTING_SOON,
        lesson.id,
      ),
    },
    {
      ...common,
      userId: lesson.studentUserId,
      title: 'Sua aula começa em breve',
      message: `Aula com ${lesson.teacherName} às ${time}.`,
      uniqueHash: notificationHash(
        lesson.studentUserId,
        NotificationType.LESSON_STARTING_SOON,
        lesson.id,
      ),
    },
  ];
}

/** Aula de amanhã, para quem organiza a semana. */
export function lessonTomorrow(
  lesson: LessonForNotice,
): CreateNotificationInput[] {
  const when = `${formatDate(lesson.scheduledAt)} às ${formatTime(lesson.scheduledAt)}`;

  const common = {
    type: NotificationType.LESSON_TOMORROW,
    priority: NotificationPriority.MEDIUM,
    relatedEntityType: 'lesson',
    relatedEntityId: lesson.id,
    actionText: 'Ver aula',
    actionUrl: `/portal/aulas/${lesson.id}`,
    expiresAt: lesson.scheduledAt,
  };

  return [
    {
      ...common,
      userId: lesson.teacherUserId,
      title: 'Aula amanhã',
      message: `Aula com ${lesson.studentName} em ${when}.`,
      uniqueHash: notificationHash(
        lesson.teacherUserId,
        NotificationType.LESSON_TOMORROW,
        lesson.id,
      ),
    },
    {
      ...common,
      userId: lesson.studentUserId,
      title: 'Aula amanhã',
      message: `Aula com ${lesson.teacherName} em ${when}.`,
      uniqueHash: notificationHash(
        lesson.studentUserId,
        NotificationType.LESSON_TOMORROW,
        lesson.id,
      ),
    },
  ];
}

/**
 * Aula que passou e continua marcada como agendada.
 *
 * Só o professor recebe: registrar presença e resultado é tarefa dele, e cobrar
 * do aluno um status que ele não pode dar seria ruído.
 */
export function lessonNeedsStatus(
  lesson: LessonForNotice,
): CreateNotificationInput[] {
  return [
    {
      userId: lesson.teacherUserId,
      type: NotificationType.LESSON_STATUS_PENDING,
      priority: NotificationPriority.MEDIUM,
      title: 'Aula sem status',
      message: `A aula com ${lesson.studentName} de ${formatDate(lesson.scheduledAt)} ainda está como agendada.`,
      relatedEntityType: 'lesson',
      relatedEntityId: lesson.id,
      actionText: 'Atualizar',
      actionUrl: `/portal/aulas/${lesson.id}`,
      uniqueHash: notificationHash(
        lesson.teacherUserId,
        NotificationType.LESSON_STATUS_PENDING,
        lesson.id,
      ),
    },
  ];
}

/** Tarefa vencendo nas próximas 24 horas. */
export function assignmentDueSoon(
  assignment: AssignmentForNotice,
): CreateNotificationInput[] {
  return [
    {
      userId: assignment.studentUserId,
      type: NotificationType.ASSIGNMENT_DUE_SOON,
      priority: NotificationPriority.HIGH,
      title: 'Tarefa vencendo',
      message: `"${assignment.title}" vence em ${formatDate(assignment.dueDate)} às ${formatTime(assignment.dueDate)}.`,
      relatedEntityType: 'assignment',
      relatedEntityId: assignment.id,
      actionText: 'Ver tarefa',
      actionUrl: `/portal/tarefas/${assignment.id}`,
      // Depois do vencimento o aviso certo é o de atraso, não este.
      expiresAt: assignment.dueDate,
      uniqueHash: notificationHash(
        assignment.studentUserId,
        NotificationType.ASSIGNMENT_DUE_SOON,
        assignment.id,
      ),
    },
  ];
}

/**
 * Tarefa atrasada.
 *
 * **Sem prazo de validade, de propósito.** Uma tarefa atrasada continua
 * atrasada; o aviso só deixa de fazer sentido quando ela for entregue, e aí
 * quem o encerra é a entrega, não o relógio.
 */
export function assignmentOverdue(
  assignment: AssignmentForNotice,
): CreateNotificationInput[] {
  return [
    {
      userId: assignment.studentUserId,
      type: NotificationType.ASSIGNMENT_OVERDUE,
      priority: NotificationPriority.HIGH,
      title: 'Tarefa atrasada',
      message: `"${assignment.title}" venceu em ${formatDate(assignment.dueDate)}.`,
      relatedEntityType: 'assignment',
      relatedEntityId: assignment.id,
      actionText: 'Ver tarefa',
      actionUrl: `/portal/tarefas/${assignment.id}`,
      uniqueHash: notificationHash(
        assignment.studentUserId,
        NotificationType.ASSIGNMENT_OVERDUE,
        assignment.id,
      ),
    },
  ];
}

/** Convite de aluno ainda pendente. */
export function invitePending(
  invite: InviteForNotice,
): CreateNotificationInput[] {
  return [
    {
      userId: invite.teacherUserId,
      type: NotificationType.STUDENT_INVITE_PENDING,
      priority: NotificationPriority.LOW,
      title: 'Convite pendente',
      message: `${invite.studentName} ainda não respondeu ao seu convite.`,
      relatedEntityType: 'teacherStudent',
      relatedEntityId: invite.id,
      actionText: 'Ver alunos',
      actionUrl: '/portal/alunos',
      uniqueHash: notificationHash(
        invite.teacherUserId,
        NotificationType.STUDENT_INVITE_PENDING,
        invite.id,
      ),
    },
  ];
}
