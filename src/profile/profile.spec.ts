import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserTokenService } from '../auth/user-token.service';
import { AppCacheService } from '../common/cache/cache.service';
import { StorageService } from '../common/storage/storage.service';
import { MailService } from '../mail/mail.service';
import { PortalProfileService } from '../portal/profile/profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { PersonalDataExportService } from './export/personal-data-export.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { parsePhoneNumber } from './utils/phone-parser.util';

const USER = '64b000000000000000000001';

describe('parsePhoneNumber', () => {
  it('separa país e número', () => {
    expect(parsePhoneNumber('+55 (81) 99999-0000')).toEqual({
      phoneCountryCode: 'BR',
      phoneNumber: '81999990000',
    });
  });

  // O legado tomava "5581" como código do país e perdia o Brasil e o DDD.
  it('número sem espaço: código conhecido mais longo, DDD preservado', () => {
    expect(parsePhoneNumber('+5581999990000')).toEqual({
      phoneCountryCode: 'BR',
      phoneNumber: '81999990000',
    });
    expect(parsePhoneNumber('+14155550100')).toEqual({
      phoneCountryCode: 'US',
      phoneNumber: '4155550100',
    });
  });

  it('código desconhecido, sem "+" ou vazio', () => {
    expect(parsePhoneNumber('+999123')).toEqual({
      phoneCountryCode: null,
      phoneNumber: '999123',
    });
    expect(parsePhoneNumber('81999990000')).toEqual({
      phoneCountryCode: null,
      phoneNumber: null,
    });
    expect(parsePhoneNumber('')).toEqual({
      phoneCountryCode: null,
      phoneNumber: null,
    });
    expect(parsePhoneNumber('+')).toEqual({
      phoneCountryCode: null,
      phoneNumber: null,
    });
  });
});

/** Linha da conta como o `select` do perfil a traz. */
const accountRow = (over: Record<string, unknown> = {}) => ({
  id: USER,
  email: 'ana@x.com',
  username: 'ana',
  firstName: 'Ana',
  lastName: 'Lima',
  image: null,
  bio: null,
  role: 0,
  isTeacher: false,
  isStudent: false,
  userType: null,
  onboardingCompleted: true,
  emailVerified: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  lastSeen: null,
  city: null,
  state: null,
  country: null,
  phone: null,
  phoneCountryCode: null,
  phoneNumber: null,
  favoriteComposerId: null,
  favoriteEpochId: null,
  experienceLevel: 'BEGINNER',
  practiceTimePerWeek: null,
  profilePublic: true,
  showLocation: false,
  currentPlan: 'FREE',
  planExpiresAt: null,
  isTrialActive: false,
  totalXP: 0,
  hashedPassword: 'hash',
  accounts: [],
  teacherProfile: null,
  ...over,
});

describe('ProfileService', () => {
  let prisma: Record<string, Record<string, jest.Mock>> & {
    $transaction: jest.Mock;
  };
  let tx: {
    user: { update: jest.Mock };
    userInstrument: { deleteMany: jest.Mock; createMany: jest.Mock };
    student: { update: jest.Mock };
    teacher: { update: jest.Mock };
  };
  let mail: {
    sendEmailChangeRequestEmail: jest.Mock;
    sendAccountDeletedFarewellEmail: jest.Mock;
  };
  let tokens: {
    revokeAllUserTokens: jest.Mock;
    checkRateLimit: jest.Mock;
    createToken: jest.Mock;
  };
  let storage: { uploadFile: jest.Mock };
  let cache: { invalidateMany: jest.Mock };
  let portal: Record<string, jest.Mock>;
  let service: ProfileService;
  let argonHash: string;

  beforeAll(async () => {
    argonHash = await argon2.hash('SenhaAtual1!');
  });

  beforeEach(() => {
    const count = () => jest.fn().mockResolvedValue(1);
    tx = {
      user: { update: jest.fn().mockResolvedValue({}) },
      userInstrument: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
      },
      student: { update: jest.fn().mockResolvedValue({}) },
      teacher: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(({ data }) => Promise.resolve({ id: USER, ...data })),
        delete: jest.fn().mockResolvedValue({}),
      },
      composer: { count: count(), findMany: jest.fn().mockResolvedValue([]) },
      work: { count: count(), findMany: jest.fn().mockResolvedValue([]) },
      workScore: { count: count() },
      workAnnotation: {
        count: count(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      favoriteWork: { count: count() },
      userInstrument: {
        count: count(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      favoriteComposer: { count: count() },
      learned: { count: count() },
      wantToLearn: { count: count() },
      teacherStudent: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;
    mail = {
      sendEmailChangeRequestEmail: jest.fn().mockResolvedValue(undefined),
      sendAccountDeletedFarewellEmail: jest.fn().mockResolvedValue(undefined),
    };
    tokens = {
      revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
      createToken: jest.fn().mockResolvedValue('tok'),
    };
    storage = {
      uploadFile: jest
        .fn()
        .mockResolvedValue({ secureUrl: 'https://cdn/avatar.jpg' }),
    };
    cache = { invalidateMany: jest.fn().mockResolvedValue(undefined) };
    portal = {
      teacherSection: jest.fn().mockResolvedValue({
        profile: { id: 't1' },
        isNew: false,
        students: [],
      }),
      studentSection: jest.fn().mockResolvedValue({
        profile: { id: 's1' },
        isNew: false,
        teachers: [],
      }),
      ensureTeacher: jest.fn().mockResolvedValue({ created: false }),
      ensureStudent: jest.fn().mockResolvedValue({ created: false }),
      studentData: jest.fn((dto: object) => ({ ...dto, convertido: 'aluno' })),
      teacherData: jest.fn((dto: object) => ({
        ...dto,
        convertido: 'professor',
      })),
      recordProfileChange: jest.fn().mockResolvedValue(undefined),
    };
    service = new ProfileService(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
      tokens as unknown as UserTokenService,
      {
        get: jest.fn((_k: string, fallback: string) => fallback),
      } as unknown as ConfigService,
      storage as unknown as StorageService,
      cache as unknown as AppCacheService,
      portal as unknown as PortalProfileService,
    );
  });

  /** Papéis da conta; a leitura do perfil (que pede a senha) recebe a linha inteira. */
  const withAccount = (over: Record<string, unknown> = {}) =>
    prisma.user.findUnique.mockImplementation(
      ({ select }: { select: Record<string, unknown> }) =>
        Promise.resolve(
          select.hashedPassword
            ? accountRow(over)
            : {
                isTeacher: false,
                isStudent: false,
                onboardingCompleted: true,
                ...over,
              },
        ),
    );

  describe('ler o perfil', () => {
    it('sem include vem tudo: conta, instrumentos, estatísticas e os papéis da conta', async () => {
      withAccount({
        isTeacher: true,
        teacherProfile: { isVerified: true },
        accounts: [{ provider: 'google' }, { provider: 'google' }],
      });
      prisma.userInstrument.findMany.mockResolvedValue([
        {
          id: 'ui1',
          instrumentId: 'i1',
          level: 'BEGINNER',
          isPrimary: true,
          isLearning: false,
          startedAt: null,
          instrument: { name: 'Piano', category: 'Teclado' },
        },
      ]);

      const result = await service.get(USER);

      expect(result.account).toMatchObject({
        id: USER,
        name: 'Ana Lima',
        teacherVerified: true,
        studentInviteStatus: null,
        login: { hasPassword: true, providers: ['google'] },
      });
      // O que serve só para calcular não sai na resposta.
      expect(result.account).not.toHaveProperty('hashedPassword');
      expect(result.account).not.toHaveProperty('accounts');
      expect(result.account).not.toHaveProperty('teacherProfile');
      expect(result.instruments).toEqual([
        expect.objectContaining({ name: 'Piano', category: 'Teclado' }),
      ]);
      expect(result.stats).toEqual({
        instrumentsCount: 1,
        favoriteWorksCount: 1,
        favoriteComposersCount: 1,
        learnedWorksCount: 1,
      });
      expect(result.teacher).toEqual({
        profile: { id: 't1' },
        isNew: false,
        students: [],
      });
      // Quem não é aluno não ganha perfil de aluno por ler o próprio perfil.
      expect(result.student).toBeNull();
      expect(portal.studentSection).not.toHaveBeenCalled();
    });

    it('"quem sou eu": include=account traz só a conta, sem consultar o resto', async () => {
      withAccount();

      const result = await service.get(USER, 'account');

      expect(Object.keys(result)).toEqual(['account']);
      expect(result.account.teacherVerified).toBeNull();
      expect(prisma.userInstrument.findMany).not.toHaveBeenCalled();
      expect(portal.teacherSection).not.toHaveBeenCalled();
    });

    it('escolhe as partes pedidas', async () => {
      withAccount({ isStudent: true });

      const result = await service.get(USER, 'stats,student');

      expect(result).toHaveProperty('stats');
      expect(result.student).toEqual({
        profile: { id: 's1' },
        isNew: false,
        teachers: [],
      });
      expect(result).not.toHaveProperty('instruments');
      expect(result).not.toHaveProperty('teacher');
    });

    // O legado ordenava o enum achando que ACCEPTED vinha antes — mas a ordem
    // é alfabética, e o aluno aceito aparecia pendente.
    it('convite do aluno: vale o aceito, se houver; senão, o mais recente', async () => {
      withAccount({ isStudent: true });

      prisma.teacherStudent.findMany.mockResolvedValue([
        { inviteStatus: 'PENDING' },
        { inviteStatus: 'ACCEPTED' },
      ]);
      expect(
        (await service.get(USER, 'account')).account.studentInviteStatus,
      ).toBe('ACCEPTED');

      prisma.teacherStudent.findMany.mockResolvedValue([
        { inviteStatus: 'PENDING' },
        { inviteStatus: 'DECLINED' },
      ]);
      expect(
        (await service.get(USER, 'account')).account.studentInviteStatus,
      ).toBe('PENDING');

      prisma.teacherStudent.findMany.mockResolvedValue([]);
      expect(
        (await service.get(USER, 'account')).account.studentInviteStatus,
      ).toBeNull();

      expect(prisma.teacherStudent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { student: { userId: USER }, isActive: true },
        }),
      );
    });

    it('professor ainda sem perfil aparece como não verificado', async () => {
      withAccount({ isTeacher: true, teacherProfile: null });

      expect((await service.get(USER, 'account')).account.teacherVerified).toBe(
        false,
      );
    });

    it('conta inexistente é 404', async () => {
      await expect(service.get(USER)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('atualizar', () => {
    it('corpo vazio é 400', async () => {
      withAccount();

      await expect(service.update(USER, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('bloco de professor ou de aluno em conta sem o papel é 403', async () => {
      withAccount();

      await expect(
        service.update(USER, { teacher: { bio: 'oi' } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.update(USER, { student: { mainInstrument: 'Piano' } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('conta: só o que veio; branco vira nulo; telefone separado em país e número', async () => {
      withAccount();

      await service.update(USER, {
        account: {
          firstName: 'Ana',
          bio: '  ',
          phone: '+5581999990000',
          favoriteComposerId: null,
          userType: 'TEACHER',
          profilePublic: false,
        },
      } as never);

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: USER },
        data: {
          firstName: 'Ana',
          bio: null,
          phone: '+5581999990000',
          phoneCountryCode: 'BR',
          phoneNumber: '81999990000',
          favoriteComposerId: null,
          userType: 'TEACHER',
          profilePublic: false,
        },
      });
      // O diretório público de professores mostra estes dados e tem cache.
      expect(cache.invalidateMany).toHaveBeenCalledWith(['teachers']);
    });

    it('telefone vazio apaga os três campos; os demais campos da conta também passam', async () => {
      withAccount();

      await service.update(USER, {
        account: {
          phone: '',
          lastName: 'Lima',
          city: 'Recife',
          state: 'PE',
          country: 'Brasil',
          experienceLevel: 'ADVANCED',
          favoriteEpochId: '64b000000000000000000002',
          practiceTimePerWeek: 5,
          showLocation: true,
        },
      } as never);

      expect(tx.user.update.mock.calls[0][0].data).toEqual({
        phone: null,
        phoneCountryCode: null,
        phoneNumber: null,
        lastName: 'Lima',
        city: 'Recife',
        state: 'PE',
        country: 'Brasil',
        experienceLevel: 'ADVANCED',
        favoriteEpochId: '64b000000000000000000002',
        practiceTimePerWeek: 5,
        showLocation: true,
      });
    });

    it('instrumentos: substitui a lista na mesma transação; vazia só apaga; dois principais é 400', async () => {
      withAccount();
      const piano = {
        instrumentId: 'i1',
        level: 'BEGINNER',
        isPrimary: true,
        isLearning: true,
      };

      const result = await service.update(USER, {
        instruments: [piano],
      } as never);
      expect(tx.userInstrument.createMany).toHaveBeenCalledWith({
        data: [{ userId: USER, ...piano }],
      });
      expect(result).toHaveProperty('instruments');
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(portal.recordProfileChange).toHaveBeenCalledWith(
        USER,
        { isTeacher: false, isStudent: false },
        { conta: ['instruments'] },
      );

      tx.userInstrument.createMany.mockClear();
      await service.update(USER, { instruments: [] });
      expect(tx.userInstrument.deleteMany).toHaveBeenCalledTimes(2);
      expect(tx.userInstrument.createMany).not.toHaveBeenCalled();

      await expect(
        service.update(USER, {
          instruments: [piano, { ...piano, instrumentId: 'i2' }],
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('perfis do portal: garante o registro, converte pelo portal e registra na trilha', async () => {
      withAccount({ isTeacher: true, isStudent: true });

      const result = await service.update(USER, {
        teacher: { bio: 'Piano' },
        student: { mainInstrument: 'Violino' },
      });

      expect(portal.ensureTeacher).toHaveBeenCalledWith(USER);
      expect(portal.ensureStudent).toHaveBeenCalledWith(USER);
      expect(tx.teacher.update).toHaveBeenCalledWith({
        where: { userId: USER },
        data: { bio: 'Piano', convertido: 'professor' },
      });
      expect(tx.student.update.mock.calls[0][0].data).toEqual({
        mainInstrument: 'Violino',
        convertido: 'aluno',
        lastActiveAt: expect.any(Date),
      });
      expect(portal.recordProfileChange).toHaveBeenCalledWith(
        USER,
        { isTeacher: true, isStudent: true },
        { professor: ['bio'], aluno: ['mainInstrument'] },
      );
      expect(result).toHaveProperty('teacher');
      expect(result).toHaveProperty('student');
      expect(result).not.toHaveProperty('stats');
    });
  });

  describe('cadastro inicial', () => {
    it('já concluído é 409', async () => {
      withAccount({ onboardingCompleted: true });

      await expect(service.completeOnboarding(USER, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('marca concluído, cria o perfil do papel e ignora bloco de papel que a conta não tem', async () => {
      withAccount({ onboardingCompleted: false, isStudent: true });

      const result = await service.completeOnboarding(USER, {
        account: { city: 'Recife' },
        teacher: { bio: 'tentativa' },
        student: { mainInstrument: 'Piano' },
      });

      expect(tx.user.update.mock.calls[0][0].data).toEqual({
        city: 'Recife',
        onboardingCompleted: true,
      });
      expect(portal.ensureStudent).toHaveBeenCalledWith(USER);
      expect(portal.ensureTeacher).not.toHaveBeenCalled();
      expect(tx.teacher.update).not.toHaveBeenCalled();
      expect(tx.student.update).toHaveBeenCalled();
      // Devolve o perfil completo.
      expect(result).toHaveProperty('stats');
    });

    it('sem nada no corpo, só marca concluído; professor ganha o perfil', async () => {
      withAccount({ onboardingCompleted: false, isTeacher: true });

      await service.completeOnboarding(USER, {});

      expect(tx.user.update.mock.calls[0][0].data).toEqual({
        onboardingCompleted: true,
      });
      expect(portal.ensureTeacher).toHaveBeenCalledWith(USER);
    });

    it('conta inexistente é 404', async () => {
      await expect(service.completeOnboarding(USER, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('trocar senha', () => {
    it('conta social define a primeira senha, sem pedir a atual', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: USER,
        hashedPassword: null,
      });

      await service.changePassword(USER, {
        currentPassword: '',
        newPassword: 'Nova1234!',
      } as never);

      expect(prisma.user.update).toHaveBeenCalled();
      expect(tokens.revokeAllUserTokens).not.toHaveBeenCalled();
    });

    it('troca, e derruba as sessões', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: USER,
        hashedPassword: argonHash,
      });

      await service.changePassword(USER, {
        currentPassword: 'SenhaAtual1!',
        newPassword: 'Nova1234!',
      } as never);

      expect(tokens.revokeAllUserTokens).toHaveBeenCalledWith(
        USER,
        'REFRESH_TOKEN',
      );
    });

    it('senha atual errada, nova igual à atual, conta inexistente', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: USER,
        hashedPassword: argonHash,
      });
      await expect(
        service.changePassword(USER, {
          currentPassword: 'errada',
          newPassword: 'Nova1234!',
        } as never),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.changePassword(USER, {
          currentPassword: 'SenhaAtual1!',
          newPassword: 'SenhaAtual1!',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.changePassword(USER, {} as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hash bcrypt do legado ainda confere', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: USER,
        hashedPassword: await bcrypt.hash('Legado1!', 4),
      });

      await service.changePassword(USER, {
        currentPassword: 'Legado1!',
        newPassword: 'Nova1234!',
      } as never);

      expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  describe('trocar e-mail', () => {
    const ctx = { ipAddress: '1.1.1.1', userAgent: 'UA' };
    const dto = {
      newEmail: ' Novo@X.com ',
      currentPassword: 'SenhaAtual1!',
    } as never;

    beforeEach(() => {
      prisma.user.findUnique.mockImplementation(({ where }) =>
        Promise.resolve(
          where.id
            ? {
                id: USER,
                email: 'ana@x.com',
                firstName: null,
                hashedPassword: argonHash,
              }
            : null,
        ),
      );
    });

    it('manda o link para o e-mail novo', async () => {
      await service.requestEmailChange(USER, dto, ctx);

      expect(tokens.createToken).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'EMAIL_CHANGE',
          metadata: expect.objectContaining({ newEmail: 'novo@x.com' }),
        }),
      );
      expect(mail.sendEmailChangeRequestEmail).toHaveBeenCalledWith(
        'novo@x.com',
        {
          firstName: 'Usuário',
          confirmationUrl: 'http://localhost:3000/confirm-email-change/tok',
        },
      );
    });

    it('recusa: sem senha, senha errada, mesmo e-mail, e-mail de outra conta, limite', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: USER,
        email: 'a',
        hashedPassword: null,
      });
      await expect(service.requestEmailChange(USER, dto, ctx)).rejects.toThrow(
        'defina uma senha',
      );

      await expect(
        service.requestEmailChange(
          USER,
          { newEmail: 'n@x.com', currentPassword: 'errada' } as never,
          ctx,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      await expect(
        service.requestEmailChange(
          USER,
          { newEmail: 'ANA@x.com', currentPassword: 'SenhaAtual1!' } as never,
          ctx,
        ),
      ).rejects.toThrow('Este já é o seu e-mail atual');

      prisma.user.findUnique.mockImplementation(({ where }) =>
        Promise.resolve(
          where.id
            ? { id: USER, email: 'ana@x.com', hashedPassword: argonHash }
            : { id: 'outro' },
        ),
      );
      await expect(
        service.requestEmailChange(USER, dto, ctx),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.user.findUnique.mockImplementation(({ where }) =>
        Promise.resolve(
          where.id
            ? { id: USER, email: 'ana@x.com', hashedPassword: argonHash }
            : null,
        ),
      );
      tokens.checkRateLimit.mockResolvedValue({ allowed: false });
      await expect(service.requestEmailChange(USER, dto, ctx)).rejects.toThrow(
        'Muitas tentativas',
      );

      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.requestEmailChange(USER, dto, ctx),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('o que some com a conta soma tudo', async () => {
    const info = await service.getCascadeInfo(USER);

    expect(info.totalItems).toBe(9);
    expect(info.sampleComposers).toEqual([]);
  });

  describe('excluir a conta', () => {
    it('com senha: exige e confere; despede-se por e-mail', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: USER,
        email: 'a@x.com',
        firstName: 'Ana',
        lastName: 'Lima',
        hashedPassword: argonHash,
      });

      await expect(service.deleteAccount(USER, {} as never)).rejects.toThrow(
        'Confirme sua senha',
      );
      await expect(
        service.deleteAccount(USER, { currentPassword: 'x' } as never),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const result = await service.deleteAccount(USER, {
        currentPassword: 'SenhaAtual1!',
      } as never);
      expect(result).toMatchObject({ email: 'a@x.com', name: 'Ana Lima' });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: USER } });
    });

    it('e-mail de despedida que falha não impede a exclusão; sem senha nem e-mail', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: USER,
        email: 'a@x.com',
        firstName: null,
        lastName: null,
        hashedPassword: null,
      });
      mail.sendAccountDeletedFarewellEmail.mockRejectedValue(new Error('smtp'));
      await expect(
        service.deleteAccount(USER, {} as never),
      ).resolves.toMatchObject({ name: '' });

      prisma.user.findUnique.mockResolvedValue({
        id: USER,
        email: null,
        hashedPassword: null,
      });
      await service.deleteAccount(USER, {} as never);

      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.deleteAccount(USER, {} as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('heartbeat grava o último acesso, com ou sem hora informada', async () => {
    await service.heartbeat(USER, {
      timestamp: '2026-09-01T10:00:00Z',
    } as never);
    expect(prisma.user.update.mock.calls[0][0].data.lastSeen).toEqual(
      new Date('2026-09-01T10:00:00Z'),
    );

    await expect(service.heartbeat(USER, {} as never)).resolves.toMatchObject({
      success: true,
    });
  });

  it('remover a foto apaga só o arquivo de foto e limpa o campo', async () => {
    const files = {
      findActiveByEntity: jest.fn().mockResolvedValue([
        { id: 'a1', kind: 'PROFILE_IMAGE' },
        { id: 'a2', kind: 'SCORE_FILE' },
      ]),
      deleteAsset: jest.fn().mockResolvedValue(undefined),
    };
    Object.assign(storage, files);

    await service.removeAvatar(USER);

    expect(files.findActiveByEntity).toHaveBeenCalledWith('user', USER);
    expect(files.deleteAsset).toHaveBeenCalledTimes(1);
    expect(files.deleteAsset).toHaveBeenCalledWith('a1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER },
      data: { image: null },
    });
    expect(cache.invalidateMany).toHaveBeenCalledWith(['teachers']);
  });

  it('foto de perfil vai para o armazenamento e atualiza o diretório', async () => {
    const file = { buffer: Buffer.from('x'), originalName: 'a.jpg', size: 1 };

    await expect(service.updateAvatar(USER, file)).resolves.toEqual({
      imageUrl: 'https://cdn/avatar.jpg',
    });
    expect(storage.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'PROFILE_IMAGE', ownerId: USER }),
      file,
    );
    expect(cache.invalidateMany).toHaveBeenCalled();

    storage.uploadFile.mockResolvedValue({ secureUrl: null });
    await expect(service.updateAvatar(USER, file)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe('ProfileController', () => {
  const user: AccessTokenPayload = {
    sub: USER,
    email: 'a@x.com',
    role: 0,
    isTeacher: false,
    isStudent: false,
    type: 'access',
  };
  const methods = [
    'get',
    'update',
    'completeOnboarding',
    'changePassword',
    'requestEmailChange',
    'getCascadeInfo',
    'deleteAccount',
    'heartbeat',
    'updateAvatar',
    'removeAvatar',
  ];
  const service = Object.fromEntries(
    methods.map((m) => [m, jest.fn().mockResolvedValue(m)]),
  );
  const exporter = {
    collect: jest.fn().mockResolvedValue({
      generatedAt: new Date('2026-09-13T12:00:00Z'),
      sections: {},
    }),
  };
  const controller = new ProfileController(
    service as unknown as ProfileService,
    exporter as unknown as PersonalDataExportService,
  );

  it('cada rota repassa ao serviço com o id do token', async () => {
    await expect(
      controller.getProfile(user, { include: 'account' }),
    ).resolves.toBe('get');
    expect(service.get).toHaveBeenCalledWith(USER, 'account');
    await controller.getProfile(user, {});
    expect(service.get).toHaveBeenLastCalledWith(USER, undefined);

    await expect(controller.updateProfile(user, {} as never)).resolves.toBe(
      'update',
    );
    await expect(
      controller.completeOnboarding(user, {} as never),
    ).resolves.toBe('completeOnboarding');
    await controller.changePassword(user, {} as never);
    await expect(controller.getCascadeInfo(user)).resolves.toBe(
      'getCascadeInfo',
    );
    await expect(controller.deleteAccount(user, {} as never)).resolves.toBe(
      'deleteAccount',
    );
    await expect(controller.heartbeat(user, {} as never)).resolves.toBe(
      'heartbeat',
    );

    expect(service.update).toHaveBeenCalledWith(USER, {});
    expect(service.completeOnboarding).toHaveBeenCalledWith(USER, {});
    expect(service.changePassword).toHaveBeenCalledWith(USER, {});
  });

  it('troca de e-mail leva IP e navegador', async () => {
    await controller.requestEmailChange(
      user,
      {} as never,
      {
        headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1', 'user-agent': 'UA' },
      } as unknown as Request,
    );
    expect(service.requestEmailChange).toHaveBeenLastCalledWith(
      USER,
      {},
      { ipAddress: '9.9.9.9', userAgent: 'UA' },
    );

    await controller.requestEmailChange(
      user,
      {} as never,
      { headers: {}, ip: '2.2.2.2' } as unknown as Request,
    );
    expect(service.requestEmailChange).toHaveBeenLastCalledWith(
      USER,
      {},
      { ipAddress: '2.2.2.2', userAgent: 'unknown' },
    );

    await controller.requestEmailChange(
      user,
      {} as never,
      { headers: {} } as unknown as Request,
    );
    expect(service.requestEmailChange).toHaveBeenLastCalledWith(
      USER,
      {},
      { ipAddress: 'unknown', userAgent: 'unknown' },
    );
  });

  it('exportação vai como anexo datado', async () => {
    const response = { setHeader: jest.fn() } as unknown as Response;

    await controller.exportPersonalData(user, response);

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="opus-atlas-dados-2026-09-13.json"',
    );
  });

  it('remover a foto repassa o id do token', async () => {
    await controller.removeAvatar(user);

    expect(service.removeAvatar).toHaveBeenCalledWith(USER);
  });

  it('foto: sem arquivo é 400; com arquivo repassa os bytes', async () => {
    await expect(
      controller.updateAvatar(user, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);

    await controller.updateAvatar(user, {
      buffer: Buffer.from('x'),
      originalname: 'a.jpg',
      size: 1,
    } as never);
    expect(service.updateAvatar).toHaveBeenCalledWith(USER, {
      buffer: Buffer.from('x'),
      originalName: 'a.jpg',
      size: 1,
    });
  });
});
