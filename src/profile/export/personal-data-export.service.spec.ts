import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PersonalDataExportService } from './personal-data-export.service';

describe('PersonalDataExportService', () => {
  let service: PersonalDataExportService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  const model = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
  });

  beforeEach(async () => {
    prisma = {
      user: model(),
      teacher: model(),
      student: model(),
      userInstrument: model(),
      annotation: model(),
      workAnnotation: model(),
      favoriteWork: model(),
      favoriteComposer: model(),
      favoriteScore: model(),
      wantToLearn: model(),
      learned: model(),
      composer: model(),
      work: model(),
      workScore: model(),
      uploadHistory: model(),
      userAchievement: model(),
      achievementProgress: model(),
      notification: model(),
      schoolActivity: model(),
      newsletterSubscriber: model(),
      subscription: model(),
      payment: model(),
      storedAsset: model(),
      blogComment: model(),
      lesson: model(),
      assignment: model(),
    };

    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'ana@exemplo.com',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalDataExportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PersonalDataExportService);
  });

  it('identifica de quem é o documento', async () => {
    const document = await service.collect('user-1');

    expect(document.subject).toEqual({
      userId: 'user-1',
      email: 'ana@exemplo.com',
    });
    expect(document.formatVersion).toBe('1.0');
  });

  it('recusa conta inexistente', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.collect('sumiu')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // Portabilidade é levar os seus dados, não as chaves da sua conta.
  it('nunca seleciona o hash de senha', async () => {
    await service.collect('user-1');

    expect(prisma.user.findUnique.mock.calls[0][0].select).not.toHaveProperty(
      'hashedPassword',
    );
  });

  it('não toca em token, sessão nem conta de OAuth', async () => {
    await service.collect('user-1');

    expect(prisma.userToken).toBeUndefined();
    expect(prisma.session).toBeUndefined();
    expect(prisma.account).toBeUndefined();
  });

  it('explica no documento o que ficou de fora', async () => {
    const document = await service.collect('user-1');

    expect(document.excluded.length).toBeGreaterThanOrEqual(3);
    for (const item of document.excluded) {
      expect(item.what.length).toBeGreaterThan(0);
      expect(item.why.length).toBeGreaterThan(0);
    }
  });

  describe('portal', () => {
    // `Lesson.teacherId` referencia `Teacher.id`, não `User.id` — é o mesmo
    // detalhe que fazia a notificação automática do professor não casar nada.
    it('resolve os perfis antes de consultar aulas', async () => {
      prisma.teacher.findUnique.mockResolvedValue({ id: 'perfil-professor' });

      await service.collect('user-1');

      expect(prisma.lesson.findMany.mock.calls[0][0].where).toEqual({
        teacherId: 'perfil-professor',
      });
    });

    it('quem não tem perfil não recebe a seção', async () => {
      const document = await service.collect('user-1');

      expect(document.sections).not.toHaveProperty('aulasComoProfessor');
      expect(document.sections).not.toHaveProperty('aulasComoAluno');
      expect(document.sections).not.toHaveProperty('tarefas');
    });

    // A avaliação que o professor escreveu para si não é dado do aluno.
    it('a exportação do aluno não traz as notas privadas do professor', async () => {
      prisma.student.findUnique.mockResolvedValue({ id: 'perfil-aluno' });

      await service.collect('user-1');

      const select = prisma.lesson.findMany.mock.calls[0][0].select;

      expect(select).not.toHaveProperty('teacherNotes');
      expect(select.studentFeedback).toBe(true);
    });

    it('a exportação do professor traz as próprias notas', async () => {
      prisma.teacher.findUnique.mockResolvedValue({ id: 'perfil-professor' });

      await service.collect('user-1');

      expect(prisma.lesson.findMany.mock.calls[0][0].select.teacherNotes).toBe(
        true,
      );
    });
  });

  // `Payment` não tem `userId`: ele pende da assinatura. É o motivo de a
  // exportação não poder ser uma varredura por nome de campo.
  it('liga pagamento à pessoa pela assinatura', async () => {
    await service.collect('user-1');

    expect(prisma.payment.findMany.mock.calls[0][0].where).toEqual({
      subscription: { userId: 'user-1' },
    });
  });

  describe('truncamento', () => {
    it('avisa quando uma seção bate no teto', async () => {
      prisma.favoriteWork.findMany.mockResolvedValue(
        Array.from({ length: 50_000 }, () => ({ workId: 'w' })),
      );

      const document = await service.collect('user-1');

      expect(document.truncatedSections).toContain('obrasFavoritas');
    });

    // Cortar em silêncio entregaria um arquivo incompleto que se apresenta
    // como completo.
    it('não avisa quando nada foi cortado', async () => {
      const document = await service.collect('user-1');

      expect(document.truncatedSections).toEqual([]);
    });

    it('limita toda seção de lista', async () => {
      await service.collect('user-1');

      for (const [name, calls] of Object.entries(prisma)) {
        for (const call of calls.findMany.mock.calls) {
          expect(call[0].take).toBe(50_000);
          expect(name).toBeDefined();
        }
      }
    });
  });
});
