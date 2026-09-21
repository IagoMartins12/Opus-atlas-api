import { AppCacheService } from '../../common/cache/cache.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { StudentInviteStatus, TokenType } from '@prisma/client';
import { UserTokenService } from '../../auth/user-token.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionsService } from '../../billing/services/subscriptions.service';
import { RelationshipsService } from './relationships.service';

describe('RelationshipsService', () => {
  let service: RelationshipsService;
  let prisma: {
    teacher: { findUnique: jest.Mock; update: jest.Mock };
    student: { findUnique: jest.Mock; upsert: jest.Mock };
    user: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    teacherStudent: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tokens: {
    createToken: jest.Mock;
    validateToken: jest.Mock;
    markTokenAsUsed: jest.Mock;
  };
  let mail: { send: jest.Mock };
  let notifications: { notify: jest.Mock };

  const context = { ipAddress: '203.0.113.10', userAgent: 'jest' };

  const teacherProfile = {
    id: 'teacher-1',
    userId: 'teacher-user',
    maxStudentsPerWeek: 50,
    user: {
      id: 'teacher-user',
      firstName: 'Ana',
      lastName: 'Costa',
      email: 'ana@example.com',
      image: null,
    },
  };

  const studentUser = {
    id: 'student-user',
    firstName: 'João',
    lastName: 'Silva',
    email: 'joao@example.com',
    image: null,
    isStudent: false,
  };

  let subscriptions: { checkFeatureAccess: jest.Mock };

  beforeEach(async () => {
    subscriptions = {
      checkFeatureAccess: jest
        .fn()
        .mockResolvedValue({ plan: 'MAESTRO', hasAccess: true, limit: -1 }),
    };

    const tx = {
      teacherStudent: { update: jest.fn().mockResolvedValue({ id: 'rel-1' }) },
      teacher: { update: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      teacher: {
        findUnique: jest.fn().mockResolvedValue(teacherProfile),
        update: jest.fn().mockResolvedValue({}),
      },
      student: {
        findUnique: jest.fn().mockResolvedValue({ id: 'student-1' }),
        upsert: jest.fn().mockResolvedValue({ id: 'student-1' }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(studentUser),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      teacherStudent: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: 'rel-1',
          inviteStatus: StudentInviteStatus.PENDING,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'rel-1',
          inviteStatus: StudentInviteStatus.PENDING,
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };

    tokens = {
      createToken: jest.fn().mockResolvedValue('tok'),
      validateToken: jest.fn(),
      markTokenAsUsed: jest.fn().mockResolvedValue(undefined),
    };
    mail = { send: jest.fn().mockResolvedValue(undefined) };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RelationshipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppCacheService, useValue: { invalidateMany: jest.fn() } },
        { provide: UserTokenService, useValue: tokens },
        { provide: MailService, useValue: mail },
        { provide: NotificationsService, useValue: notifications },
        {
          provide: ConfigService,
          useValue: { get: () => 'https://opusatlas.com' },
        },
        // Plano sem teto por padrão; o teste do limite ajusta o retorno.
        {
          provide: SubscriptionsService,
          useValue: { checkFeatureAccess: subscriptions.checkFeatureAccess },
        },
      ],
    }).compile();

    service = module.get(RelationshipsService);
  });

  describe('inviteStudent', () => {
    const dto = { studentUserId: 'student-user' };

    it('cria o vínculo como pendente e envia o convite', async () => {
      await service.inviteStudent('teacher-user', dto, context);

      expect(
        prisma.teacherStudent.create.mock.calls[0][0].data.inviteStatus,
      ).toBe(StudentInviteStatus.PENDING);
      expect(mail.send).toHaveBeenCalled();
    });

    // O professor não pode se vincular a alguém sem que a pessoa aceite.
    it('não marca o vínculo como aceito na criação', async () => {
      await service.inviteStudent('teacher-user', dto, context);

      const data = prisma.teacherStudent.create.mock.calls[0][0].data;

      expect(data.inviteAcceptedAt).toBeUndefined();
    });

    // Um aluno pode ter convites pendentes de vários professores; revogar por
    // tipo cancelaria o convite de um no instante em que outro convidasse.
    it('não revoga os convites pendentes de outros professores', async () => {
      await service.inviteStudent('teacher-user', dto, context);

      for (const call of tokens.createToken.mock.calls) {
        expect(call[0].revokePrevious).toBe(false);
      }
    });

    it('emite um token de aceite e um de recusa', async () => {
      await service.inviteStudent('teacher-user', dto, context);

      const types = tokens.createToken.mock.calls.map(
        (call: [{ type: TokenType }]) => call[0].type,
      );

      expect(types).toEqual(
        expect.arrayContaining([
          TokenType.STUDENT_INVITATION_ACCEPT,
          TokenType.STUDENT_INVITATION_DECLINE,
        ]),
      );
    });

    it('cria o perfil de aluno sob demanda', async () => {
      await service.inviteStudent('teacher-user', dto, context);

      expect(prisma.student.upsert).toHaveBeenCalled();
    });

    it('recusa convite a si mesmo', async () => {
      await expect(
        service.inviteStudent(
          'teacher-user',
          { studentUserId: 'teacher-user' },
          context,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('recusa quem não tem perfil de professor', async () => {
      prisma.teacher.findUnique.mockResolvedValue(null);

      await expect(
        service.inviteStudent('qualquer', dto, context),
      ).rejects.toThrow(ForbiddenException);
    });

    it('recusa usuário inexistente', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.inviteStudent('teacher-user', dto, context),
      ).rejects.toThrow(NotFoundException);
    });

    it('recusa aluno já vinculado', async () => {
      prisma.teacherStudent.findFirst.mockResolvedValue({
        id: 'rel-1',
        inviteStatus: StudentInviteStatus.ACCEPTED,
        isActive: true,
      });

      await expect(
        service.inviteStudent('teacher-user', dto, context),
      ).rejects.toThrow(ConflictException);
    });

    it('recusa convite duplicado ainda pendente', async () => {
      prisma.teacherStudent.findFirst.mockResolvedValue({
        id: 'rel-1',
        inviteStatus: StudentInviteStatus.PENDING,
        isActive: true,
      });

      await expect(
        service.inviteStudent('teacher-user', dto, context),
      ).rejects.toThrow(ConflictException);
    });

    // O histórico de aulas e tarefas fica preso ao id do vínculo.
    it('reaproveita o vínculo recusado em vez de criar outro', async () => {
      prisma.teacherStudent.findFirst.mockResolvedValue({
        id: 'rel-antigo',
        inviteStatus: StudentInviteStatus.DECLINED,
        isActive: false,
      });

      await service.inviteStudent('teacher-user', dto, context);

      expect(prisma.teacherStudent.update).toHaveBeenCalled();
      expect(prisma.teacherStudent.create).not.toHaveBeenCalled();
    });

    // O vínculo pendente já existe e pode ser reenviado; falhar o envio não
    // deve desfazer o convite nem devolver erro ao professor.
    it('não falha o convite quando o e-mail não sai', async () => {
      mail.send.mockRejectedValue(new Error('smtp fora'));

      await expect(
        service.inviteStudent('teacher-user', dto, context),
      ).resolves.toBeDefined();
    });

    it('não tenta enviar para aluno sem e-mail', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...studentUser, email: null });

      await service.inviteStudent('teacher-user', dto, context);

      expect(mail.send).not.toHaveBeenCalled();
    });
    // -----------------------------------------------------------------
    // Limite de alunos do plano (RN-1)
    // -----------------------------------------------------------------

    it('recusa o convite quando o plano já está no teto', async () => {
      subscriptions.checkFeatureAccess.mockResolvedValue({
        plan: 'MENTOR',
        hasAccess: true,
        limit: 7,
      });
      prisma.teacherStudent.count.mockResolvedValue(7);

      await expect(
        service.inviteStudent('teacher-user', dto, context),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.teacherStudent.create).not.toHaveBeenCalled();
    });

    it('aceita enquanto houver vaga', async () => {
      subscriptions.checkFeatureAccess.mockResolvedValue({
        plan: 'MENTOR',
        hasAccess: true,
        limit: 7,
      });
      prisma.teacherStudent.count.mockResolvedValue(6);

      await expect(
        service.inviteStudent('teacher-user', dto, context),
      ).resolves.toBeDefined();
    });

    // Quem ainda não aceitou pode nunca aceitar: contar convite pendente
    // deixaria o professor preso a um convite esquecido.
    it('convite pendente não ocupa vaga', async () => {
      subscriptions.checkFeatureAccess.mockResolvedValue({
        plan: 'MENTOR',
        hasAccess: true,
        limit: 7,
      });

      await service.inviteStudent('teacher-user', dto, context);

      expect(prisma.teacherStudent.count.mock.calls[0][0].where).toEqual({
        teacherId: 'teacher-1',
        isActive: true,
        inviteStatus: StudentInviteStatus.ACCEPTED,
      });
    });

    it('`-1` no plano significa sem teto', async () => {
      subscriptions.checkFeatureAccess.mockResolvedValue({
        plan: 'MAESTRO',
        hasAccess: true,
        limit: -1,
      });

      await service.inviteStudent('teacher-user', dto, context);

      expect(prisma.teacherStudent.count).not.toHaveBeenCalled();
    });

    // Trocar de plano para baixo não pode tirar aluno de ninguém: o que o
    // limite impede é abrir mais um vínculo.
    it('quem já passou do teto continua com os alunos que tem', async () => {
      subscriptions.checkFeatureAccess.mockResolvedValue({
        plan: 'MENTOR',
        hasAccess: true,
        limit: 7,
      });
      prisma.teacherStudent.count.mockResolvedValue(20);

      await expect(
        service.inviteStudent('teacher-user', dto, context),
      ).rejects.toThrow(ForbiddenException);

      // Nada é desativado nem removido.
      expect(prisma.teacherStudent.update).not.toHaveBeenCalled();
    });
  });

  describe('acceptInvitation', () => {
    const relationship = {
      id: 'rel-1',
      teacherId: 'teacher-1',
      inviteStatus: StudentInviteStatus.PENDING,
      teacher: {
        id: 'teacher-1',
        userId: 'teacher-user',
        user: teacherProfile.user,
      },
      student: { id: 'student-1', userId: 'student-user', user: studentUser },
    };

    beforeEach(() => {
      tokens.validateToken.mockResolvedValue({
        valid: true,
        token: { metadata: { relationshipId: 'rel-1' } },
      });
      prisma.teacherStudent.findUnique.mockResolvedValue(relationship);
    });

    it('aceita o convite e notifica as duas partes', async () => {
      const result = await service.acceptInvitation('tok');

      expect(result.accepted).toBe(true);
      expect(notifications.notify).toHaveBeenCalledTimes(2);
    });

    it('marca o token como usado', async () => {
      await service.acceptInvitation('tok');

      expect(tokens.markTokenAsUsed).toHaveBeenCalledWith('tok');
    });

    it('recusa token expirado com mensagem própria', async () => {
      tokens.validateToken.mockResolvedValue({ valid: false, expired: true });

      await expect(service.acceptInvitation('tok')).rejects.toThrow(/expirou/i);
    });

    it('recusa token já usado', async () => {
      tokens.validateToken.mockResolvedValue({ valid: false, used: true });

      await expect(service.acceptInvitation('tok')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('recusa convite já respondido', async () => {
      prisma.teacherStudent.findUnique.mockResolvedValue({
        ...relationship,
        inviteStatus: StudentInviteStatus.ACCEPTED,
      });

      await expect(service.acceptInvitation('tok')).rejects.toThrow(
        /já foi respondido/i,
      );
    });

    it('recusa token sem o vínculo no metadata', async () => {
      tokens.validateToken.mockResolvedValue({
        valid: true,
        token: { metadata: {} },
      });

      await expect(service.acceptInvitation('tok')).rejects.toThrow(
        /malformado/i,
      );
    });
  });

  describe('declineInvitation', () => {
    it('recusa o convite e avisa o professor', async () => {
      tokens.validateToken.mockResolvedValue({
        valid: true,
        token: { metadata: { relationshipId: 'rel-1' } },
      });
      prisma.teacherStudent.findUnique.mockResolvedValue({
        id: 'rel-1',
        teacherId: 'teacher-1',
        inviteStatus: StudentInviteStatus.PENDING,
        teacher: {
          id: 'teacher-1',
          userId: 'teacher-user',
          user: teacherProfile.user,
        },
        student: { id: 'student-1', userId: 'student-user', user: studentUser },
      });

      const result = await service.declineInvitation('tok');

      expect(result.declined).toBe(true);
      expect(prisma.teacherStudent.update.mock.calls[0][0].data).toMatchObject({
        inviteStatus: StudentInviteStatus.DECLINED,
        isActive: false,
      });
      expect(notifications.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('searchInvitableUsers', () => {
    it('exige ao menos 3 caracteres', async () => {
      await expect(
        service.searchInvitableUsers('teacher-user', 'ab'),
      ).rejects.toThrow(BadRequestException);
    });

    it('exclui o próprio professor e os já vinculados', async () => {
      prisma.teacherStudent.findMany.mockResolvedValue([
        { student: { userId: 'ja-aluno' } },
      ]);

      await service.searchInvitableUsers('teacher-user', 'maria');

      expect(prisma.user.findMany.mock.calls[0][0].where.id.notIn).toEqual([
        'teacher-user',
        'ja-aluno',
      ]);
    });

    // É uma busca sobre a base inteira: qualquer campo a mais vira exposição
    // de dado de terceiros.
    it('devolve apenas os campos mínimos do usuário', async () => {
      await service.searchInvitableUsers('teacher-user', 'maria');

      expect(prisma.user.findMany.mock.calls[0][0].select).toEqual({
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        image: true,
      });
    });
  });

  describe('resendInvitation', () => {
    it('recusa reenvio de convite já respondido', async () => {
      prisma.teacherStudent.findUnique.mockResolvedValue({
        id: 'rel-1',
        teacherId: 'teacher-1',
        inviteStatus: StudentInviteStatus.ACCEPTED,
        student: { id: 'student-1', userId: 'student-user', user: studentUser },
      });

      await expect(
        service.resendInvitation('teacher-user', 'rel-1', context),
      ).rejects.toThrow(BadRequestException);
    });

    // Dois pares de links vivos deixariam o aluno com botões apontando para
    // estados diferentes.
    it('invalida os links anteriores ao reenviar', async () => {
      prisma.teacherStudent.findUnique.mockResolvedValue({
        id: 'rel-1',
        teacherId: 'teacher-1',
        inviteStatus: StudentInviteStatus.PENDING,
        student: { id: 'student-1', userId: 'student-user', user: studentUser },
      });

      await service.resendInvitation('teacher-user', 'rel-1', context);

      for (const call of tokens.createToken.mock.calls) {
        expect(call[0].revokePrevious).toBe(true);
      }
    });
  });

  describe('endRelationship', () => {
    // Aulas, tarefas e relatórios apontam para o vínculo; apagá-lo levaria
    // junto o histórico das duas partes.
    it('encerra sem apagar o registro', async () => {
      prisma.teacherStudent.findUnique.mockResolvedValue({
        id: 'rel-1',
        teacherId: 'teacher-1',
        inviteStatus: StudentInviteStatus.ACCEPTED,
        student: { id: 'student-1', userId: 'student-user', user: studentUser },
      });

      await service.endRelationship(
        'teacher-user',
        'rel-1',
        'mudança de cidade',
      );

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('esconde o vínculo de outro professor como não encontrado', async () => {
      prisma.teacherStudent.findUnique.mockResolvedValue({
        id: 'rel-1',
        teacherId: 'outro-professor',
        inviteStatus: StudentInviteStatus.ACCEPTED,
        student: { id: 'student-1', userId: 'student-user', user: studentUser },
      });

      await expect(
        service.endRelationship('teacher-user', 'rel-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
