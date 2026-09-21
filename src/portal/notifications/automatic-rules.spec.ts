import { NotificationType } from '@prisma/client';
import {
  assignmentDueSoon,
  assignmentOverdue,
  invitePending,
  lessonNeedsStatus,
  lessonStartingSoon,
  lessonTomorrow,
  notificationHash,
} from './automatic-rules';

const lesson = (overrides: Record<string, unknown> = {}) => ({
  id: 'aula-1',
  title: 'Aula de piano',
  scheduledAt: new Date('2026-09-15T19:00:00.000Z'),
  teacherUserId: 'user-professor',
  studentUserId: 'user-aluno',
  teacherName: 'Clara Schumann',
  studentName: 'João Silva',
  ...overrides,
});

const assignment = (overrides: Record<string, unknown> = {}) => ({
  id: 'tarefa-1',
  title: 'Escalas maiores',
  dueDate: new Date('2026-09-16T23:59:00.000Z'),
  studentUserId: 'user-aluno',
  teacherName: 'Clara Schumann',
  ...overrides,
});

describe('notificationHash', () => {
  // É o que substitui a janela de cinco minutos do legado: a varredura repete,
  // o aviso não.
  it('é estável para o mesmo aviso', () => {
    const first = notificationHash(
      'u1',
      NotificationType.LESSON_STARTING_SOON,
      'aula-1',
    );
    const second = notificationHash(
      'u1',
      NotificationType.LESSON_STARTING_SOON,
      'aula-1',
    );

    expect(first).toBe(second);
  });

  it('distingue usuário, tipo e entidade', () => {
    const base = notificationHash(
      'u1',
      NotificationType.LESSON_STARTING_SOON,
      'a1',
    );

    expect(base).not.toBe(
      notificationHash('u2', NotificationType.LESSON_STARTING_SOON, 'a1'),
    );
    expect(base).not.toBe(
      notificationHash('u1', NotificationType.LESSON_TOMORROW, 'a1'),
    );
    expect(base).not.toBe(
      notificationHash('u1', NotificationType.LESSON_STARTING_SOON, 'a2'),
    );
  });
});

describe('lessonStartingSoon', () => {
  // No legado eram duas rotas separadas gerando o mesmo aviso, com textos
  // escritos em lugares diferentes.
  it('avisa os dois lados de uma vez', () => {
    const avisos = lessonStartingSoon(lesson());

    expect(avisos.map((aviso) => aviso.userId)).toEqual([
      'user-professor',
      'user-aluno',
    ]);
  });

  it('cada um vê o nome da outra pessoa', () => {
    const [professor, aluno] = lessonStartingSoon(lesson());

    expect(professor.message).toContain('João Silva');
    expect(aluno.message).toContain('Clara Schumann');
  });

  it('os dois avisos têm chaves de deduplicação diferentes', () => {
    const [professor, aluno] = lessonStartingSoon(lesson());

    expect(professor.uniqueHash).not.toBe(aluno.uniqueHash);
  });

  // Sem prazo, o aviso ficaria na caixa de entrada depois de a aula acontecer.
  it('expira depois da aula', () => {
    const [professor] = lessonStartingSoon(lesson());

    expect(professor.expiresAt?.getTime()).toBeGreaterThan(
      new Date('2026-09-15T19:00:00.000Z').getTime(),
    );
  });

  it('mostra o horário no fuso de São Paulo', () => {
    const [professor] = lessonStartingSoon(lesson());

    // 19:00 UTC é 16:00 em São Paulo.
    expect(professor.message).toContain('16:00');
  });
});

describe('lessonTomorrow', () => {
  it('expira quando a aula começa', () => {
    const [professor] = lessonTomorrow(lesson());

    expect(professor.expiresAt).toEqual(new Date('2026-09-15T19:00:00.000Z'));
  });
});

describe('lessonNeedsStatus', () => {
  // Cobrar do aluno um status que ele não pode dar seria ruído.
  it('avisa só o professor', () => {
    const avisos = lessonNeedsStatus(lesson());

    expect(avisos).toHaveLength(1);
    expect(avisos[0].userId).toBe('user-professor');
    expect(avisos[0].type).toBe(NotificationType.LESSON_STATUS_PENDING);
  });
});

describe('assignmentDueSoon', () => {
  it('avisa só o aluno', () => {
    const avisos = assignmentDueSoon(assignment());

    expect(avisos).toHaveLength(1);
    expect(avisos[0].userId).toBe('user-aluno');
  });

  // Depois do vencimento o aviso certo é o de atraso.
  it('expira no vencimento', () => {
    const [aviso] = assignmentDueSoon(assignment());

    expect(aviso.expiresAt).toEqual(new Date('2026-09-16T23:59:00.000Z'));
  });
});

describe('assignmentOverdue', () => {
  // Uma tarefa atrasada continua atrasada; quem encerra o aviso é a entrega.
  it('não expira', () => {
    const [aviso] = assignmentOverdue(assignment());

    expect(aviso.expiresAt).toBeUndefined();
  });

  it('é um tipo diferente do aviso de vencimento', () => {
    expect(assignmentOverdue(assignment())[0].type).toBe(
      NotificationType.ASSIGNMENT_OVERDUE,
    );
    expect(assignmentDueSoon(assignment())[0].type).toBe(
      NotificationType.ASSIGNMENT_DUE_SOON,
    );
  });
});

describe('invitePending', () => {
  it('avisa o professor que convidou', () => {
    const avisos = invitePending({
      id: 'convite-1',
      teacherUserId: 'user-professor',
      studentName: 'João Silva',
      createdAt: new Date(),
    });

    expect(avisos[0].userId).toBe('user-professor');
    expect(avisos[0].message).toContain('João Silva');
  });
});
