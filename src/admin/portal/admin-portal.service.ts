import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { escapeRegex } from '../../common/utils/regex.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ListPortalAssignmentsQueryDto,
  ListPortalLessonsQueryDto,
  ListPortalPeopleQueryDto,
} from './dto/admin-portal.dto';

const DIA = 24 * 60 * 60 * 1000;

const PESSOA = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  email: true,
  image: true,
} as const;

type Pessoa = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  email: string | null;
  image: string | null;
};

const nomeDe = (p: Pessoa | null | undefined) =>
  p
    ? [p.firstName, p.lastName].filter(Boolean).join(' ') ||
      p.username ||
      p.email
    : null;

const pessoa = (p: Pessoa | null | undefined) =>
  p ? { userId: p.id, nome: nomeDe(p), email: p.email, imagem: p.image } : null;

const isMongoId = (v: string) => /^[a-f\d]{24}$/i.test(v);

/**
 * O que acontece no portal de estudo, visto do painel: aulas que vêm e que
 * passaram, tarefas em vigor e entregues, professores e alunos. **Só
 * leitura** — o painel acompanha; quem dá aula e passa tarefa é o portal.
 *
 * As listas são por professor e por aluno porque é assim que o portal se
 * organiza hoje. Escola, quando existir, entra como mais um recorte destes
 * mesmos filtros (as aulas e tarefas da escola são as dos professores dela).
 */
@Injectable()
export class AdminPortalService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(dias = 30) {
    const agora = new Date();
    const desde = new Date(agora.getTime() - dias * DIA);
    const daqui7 = new Date(agora.getTime() + 7 * DIA);
    const ativosNoPeriodo = { scheduledAt: { gte: desde, lte: agora } };

    const [
      professores,
      professoresVerificados,
      alunos,
      vinculosAtivos,
      convitesPendentes,
      proximas7,
      porStatus,
      semDesfecho,
      tarefasPorStatus,
      tarefasAtrasadas,
      tarefasEntregues,
      professoresComAula,
      alunosComAula,
    ] = await Promise.all([
      this.prisma.teacher.count(),
      this.prisma.teacher.count({ where: { isVerified: true } }),
      this.prisma.student.count(),
      this.prisma.teacherStudent.count({ where: { isActive: true } }),
      this.prisma.teacherStudent.count({ where: { inviteStatus: 'PENDING' } }),
      this.prisma.lesson.count({
        where: {
          status: 'SCHEDULED',
          scheduledAt: { gte: agora, lte: daqui7 },
        },
      }),
      this.prisma.lesson.groupBy({
        by: ['status'],
        where: ativosNoPeriodo,
        _count: { _all: true },
      }),
      // Passou e ninguém disse se aconteceu: o desfecho que falta.
      this.prisma.lesson.count({
        where: { status: 'SCHEDULED', scheduledAt: { lt: agora } },
      }),
      this.prisma.assignment.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.assignment.count({
        where: { isCompleted: false, dueDate: { lt: agora } },
      }),
      this.prisma.assignment.count({
        where: { isCompleted: true, completedAt: { gte: desde } },
      }),
      this.prisma.lesson.findMany({
        where: ativosNoPeriodo,
        distinct: ['teacherId'],
        select: { teacherId: true },
      }),
      this.prisma.lesson.findMany({
        where: ativosNoPeriodo,
        distinct: ['studentId'],
        select: { studentId: true },
      }),
    ]);

    const aulas = Object.fromEntries(
      porStatus.map((r) => [r.status, r._count._all]),
    ) as Record<string, number>;
    const tarefas = Object.fromEntries(
      tarefasPorStatus.map((r) => [r.status, r._count._all]),
    ) as Record<string, number>;
    const concluidas = aulas.COMPLETED ?? 0;
    const faltas = aulas.NO_SHOW ?? 0;

    return {
      dias,
      professores: {
        total: professores,
        verificados: professoresVerificados,
        comAulaNoPeriodo: professoresComAula.length,
      },
      alunos: {
        total: alunos,
        comAulaNoPeriodo: alunosComAula.length,
      },
      vinculos: { ativos: vinculosAtivos, convitesPendentes },
      aulas: {
        proximos7Dias: proximas7,
        noPeriodo: porStatus.reduce((s, r) => s + r._count._all, 0),
        porStatus: aulas,
        semDesfecho,
        // Presença só conta aula que teve desfecho; sem base, não inventa.
        presenca:
          concluidas + faltas > 0
            ? Math.round((concluidas / (concluidas + faltas)) * 1000) / 10
            : null,
      },
      tarefas: {
        porStatus: tarefas,
        atrasadas: tarefasAtrasadas,
        entreguesNoPeriodo: tarefasEntregues,
      },
    };
  }

  async lessons(q: ListPortalLessonsQueryDto) {
    const agora = new Date();
    const page = q.page ?? 1;
    const limit = q.limit ?? 30;
    const and: Prisma.LessonWhereInput[] = [];

    if (q.quando === 'proximas') and.push({ scheduledAt: { gte: agora } });
    if (q.quando === 'passadas') and.push({ scheduledAt: { lt: agora } });
    if (q.quando === 'sem-desfecho') {
      and.push({ status: 'SCHEDULED', scheduledAt: { lt: agora } });
    }
    if (q.status) and.push({ status: q.status });
    if (q.teacherId && isMongoId(q.teacherId))
      and.push({ teacherId: q.teacherId });
    if (q.studentId && isMongoId(q.studentId))
      and.push({ studentId: q.studentId });
    if (q.from || q.to) {
      and.push({
        scheduledAt: {
          ...(q.from ? { gte: new Date(q.from) } : {}),
          ...(q.to ? { lte: new Date(q.to) } : {}),
        },
      });
    }
    if (q.search?.trim()) {
      and.push({
        title: { contains: escapeRegex(q.search.trim()), mode: 'insensitive' },
      });
    }

    const where: Prisma.LessonWhereInput = and.length ? { AND: and } : {};
    const [items, total] = await Promise.all([
      this.prisma.lesson.findMany({
        where,
        // Próximas: a mais perto primeiro. O resto: a mais recente primeiro.
        orderBy: { scheduledAt: q.quando === 'proximas' ? 'asc' : 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          duration: true,
          status: true,
          type: true,
          location: true,
          isRecurring: true,
          cancelReason: true,
          studentPresent: true,
          teacher: { select: { id: true, user: { select: PESSOA } } },
          student: { select: { id: true, user: { select: PESSOA } } },
          _count: { select: { assignments: true } },
        },
      }),
      this.prisma.lesson.count({ where }),
    ]);

    return {
      items: items.map((l) => ({
        id: l.id,
        titulo: l.title,
        quando: l.scheduledAt,
        duracao: l.duration,
        status: l.status,
        tipo: l.type,
        local: l.location,
        recorrente: l.isRecurring,
        motivoDoCancelamento: l.cancelReason,
        presente: l.studentPresent,
        tarefas: l._count.assignments,
        professor: { id: l.teacher.id, ...pessoa(l.teacher.user) },
        aluno: { id: l.student.id, ...pessoa(l.student.user) },
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async lesson(id: string) {
    if (!isMongoId(id)) throw new NotFoundException('Aula não encontrada');
    const l = await this.prisma.lesson.findUnique({
      where: { id },
      include: {
        teacher: { select: { id: true, user: { select: PESSOA } } },
        student: { select: { id: true, user: { select: PESSOA } } },
        assignments: {
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
            isCompleted: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!l) throw new NotFoundException('Aula não encontrada');

    const { teacher, student, ...resto } = l;
    return {
      ...resto,
      professor: { id: teacher.id, ...pessoa(teacher.user) },
      aluno: { id: student.id, ...pessoa(student.user) },
    };
  }

  async assignments(q: ListPortalAssignmentsQueryDto) {
    const agora = new Date();
    const page = q.page ?? 1;
    const limit = q.limit ?? 30;
    const and: Prisma.AssignmentWhereInput[] = [];

    if (q.situacao === 'em-vigor') {
      and.push({
        isCompleted: false,
        OR: [{ dueDate: null }, { dueDate: { gte: agora } }],
      });
    }
    if (q.situacao === 'atrasadas') {
      and.push({ isCompleted: false, dueDate: { lt: agora } });
    }
    if (q.situacao === 'concluidas') and.push({ isCompleted: true });
    if (q.studentId && isMongoId(q.studentId))
      and.push({ studentId: q.studentId });
    if (q.teacherId && isMongoId(q.teacherId)) {
      and.push({ lesson: { teacherId: q.teacherId } });
    }
    if (q.search?.trim()) {
      and.push({
        title: { contains: escapeRegex(q.search.trim()), mode: 'insensitive' },
      });
    }

    const where: Prisma.AssignmentWhereInput = and.length ? { AND: and } : {};
    const [items, total] = await Promise.all([
      this.prisma.assignment.findMany({
        where,
        orderBy:
          q.situacao === 'concluidas'
            ? { completedAt: 'desc' }
            : q.situacao === 'em-vigor'
              ? { dueDate: 'asc' }
              : { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          type: true,
          priority: true,
          status: true,
          dueDate: true,
          isCompleted: true,
          completedAt: true,
          progress: true,
          teacherRating: true,
          createdAt: true,
          student: { select: { id: true, user: { select: PESSOA } } },
          lesson: {
            select: {
              id: true,
              title: true,
              teacher: { select: { id: true, user: { select: PESSOA } } },
            },
          },
        },
      }),
      this.prisma.assignment.count({ where }),
    ]);

    return {
      items: items.map((a) => ({
        id: a.id,
        titulo: a.title,
        tipo: a.type,
        prioridade: a.priority,
        status: a.status,
        prazo: a.dueDate,
        concluida: a.isCompleted,
        concluidaEm: a.completedAt,
        atrasada: !a.isCompleted && !!a.dueDate && a.dueDate < agora,
        progresso: a.progress,
        nota: a.teacherRating,
        criadaEm: a.createdAt,
        aluno: { id: a.student.id, ...pessoa(a.student.user) },
        aula: { id: a.lesson.id, titulo: a.lesson.title },
        professor: {
          id: a.lesson.teacher.id,
          ...pessoa(a.lesson.teacher.user),
        },
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async assignment(id: string) {
    if (!isMongoId(id)) throw new NotFoundException('Tarefa não encontrada');
    const a = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        student: { select: { id: true, user: { select: PESSOA } } },
        lesson: {
          select: {
            id: true,
            title: true,
            scheduledAt: true,
            teacher: { select: { id: true, user: { select: PESSOA } } },
          },
        },
      },
    });
    if (!a) throw new NotFoundException('Tarefa não encontrada');

    const { student, lesson, ...resto } = a;
    return {
      ...resto,
      aluno: { id: student.id, ...pessoa(student.user) },
      aula: { id: lesson.id, titulo: lesson.title, quando: lesson.scheduledAt },
      professor: { id: lesson.teacher.id, ...pessoa(lesson.teacher.user) },
    };
  }

  private buscaDePessoa(search?: string): Prisma.UserWhereInput | undefined {
    const termo = search?.trim();
    if (!termo) return undefined;
    const re = { contains: escapeRegex(termo), mode: 'insensitive' as const };
    return {
      OR: [
        { firstName: re },
        { lastName: re },
        { username: re },
        { email: re },
      ],
    };
  }

  async teachers(q: ListPortalPeopleQueryDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 30;
    const busca = this.buscaDePessoa(q.search);
    const where: Prisma.TeacherWhereInput = busca ? { user: busca } : {};
    const agora = new Date();
    const desde = new Date(agora.getTime() - 30 * DIA);

    const [items, total] = await Promise.all([
      this.prisma.teacher.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          isVerified: true,
          instruments: true,
          createdAt: true,
          user: { select: PESSOA },
        },
      }),
      this.prisma.teacher.count({ where }),
    ]);

    const ids = items.map((t) => t.id);
    const [alunos, aulas30, proximas] = ids.length
      ? await Promise.all([
          this.prisma.teacherStudent.groupBy({
            by: ['teacherId'],
            where: { teacherId: { in: ids }, isActive: true },
            _count: { _all: true },
          }),
          this.prisma.lesson.groupBy({
            by: ['teacherId'],
            where: {
              teacherId: { in: ids },
              scheduledAt: { gte: desde, lte: agora },
            },
            _count: { _all: true },
          }),
          this.prisma.lesson.groupBy({
            by: ['teacherId'],
            where: {
              teacherId: { in: ids },
              status: 'SCHEDULED',
              scheduledAt: { gte: agora },
            },
            _count: { _all: true },
          }),
        ])
      : [[], [], []];
    const conta = (
      rows: Array<{ teacherId: string; _count: { _all: number } }>,
    ) => new Map(rows.map((r) => [r.teacherId, r._count._all]));
    const [mAlunos, mAulas, mProximas] = [
      conta(alunos),
      conta(aulas30),
      conta(proximas),
    ];

    return {
      items: items.map((t) => ({
        id: t.id,
        ...pessoa(t.user),
        status: t.status,
        verificado: t.isVerified,
        instrumentos: t.instruments,
        desde: t.createdAt,
        alunosAtivos: mAlunos.get(t.id) ?? 0,
        aulas30Dias: mAulas.get(t.id) ?? 0,
        proximasAulas: mProximas.get(t.id) ?? 0,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async students(q: ListPortalPeopleQueryDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 30;
    const busca = this.buscaDePessoa(q.search);
    const where: Prisma.StudentWhereInput = busca ? { user: busca } : {};
    const agora = new Date();

    const [items, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          level: true,
          mainInstrument: true,
          lastLessonAt: true,
          createdAt: true,
          user: { select: PESSOA },
          teachers: {
            where: { isActive: true },
            select: {
              teacher: { select: { id: true, user: { select: PESSOA } } },
            },
          },
        },
      }),
      this.prisma.student.count({ where }),
    ]);

    const ids = items.map((s) => s.id);
    const [emVigor, atrasadas, concluidas] = ids.length
      ? await Promise.all([
          this.prisma.assignment.groupBy({
            by: ['studentId'],
            where: { studentId: { in: ids }, isCompleted: false },
            _count: { _all: true },
          }),
          this.prisma.assignment.groupBy({
            by: ['studentId'],
            where: {
              studentId: { in: ids },
              isCompleted: false,
              dueDate: { lt: agora },
            },
            _count: { _all: true },
          }),
          this.prisma.assignment.groupBy({
            by: ['studentId'],
            where: { studentId: { in: ids }, isCompleted: true },
            _count: { _all: true },
          }),
        ])
      : [[], [], []];
    const conta = (
      rows: Array<{ studentId: string; _count: { _all: number } }>,
    ) => new Map(rows.map((r) => [r.studentId, r._count._all]));
    const [mVigor, mAtraso, mFeitas] = [
      conta(emVigor),
      conta(atrasadas),
      conta(concluidas),
    ];

    return {
      items: items.map((s) => ({
        id: s.id,
        ...pessoa(s.user),
        status: s.status,
        nivel: s.level,
        instrumento: s.mainInstrument,
        ultimaAula: s.lastLessonAt,
        desde: s.createdAt,
        professores: s.teachers.map((v) => ({
          id: v.teacher.id,
          ...pessoa(v.teacher.user),
        })),
        tarefasAbertas: mVigor.get(s.id) ?? 0,
        tarefasAtrasadas: mAtraso.get(s.id) ?? 0,
        tarefasConcluidas: mFeitas.get(s.id) ?? 0,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
