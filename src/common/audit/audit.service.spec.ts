import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: { adminAuditLog: { create: jest.Mock } };

  beforeEach(async () => {
    prisma = { adminAuditLog: { create: jest.fn().mockResolvedValue({}) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AuditService);
  });

  it('grava quem fez o quê, quando e de onde', async () => {
    await service.record({
      actorId: 'admin-1',
      actorRole: 'ADMIN',
      action: 'user.delete',
      entityType: 'user',
      entityId: 'user-9',
      ipAddress: '203.0.113.10',
      requestId: 'req-1',
      success: true,
    });

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin-1',
        action: 'user.delete',
        entityId: 'user-9',
        // Só a rede: o endereço completo identificaria a pessoa.
        ipAddress: '203.0.113.0',
        success: true,
      }),
    });
  });

  // Tentativa negada é justamente o que uma investigação precisa enxergar.
  it('registra também a ação que falhou', async () => {
    await service.record({ action: 'plan-pricing.update', success: false });

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ success: false }),
    });
  });

  // A operação de negócio já aconteceu; falhar ao auditar não pode desfazê-la.
  it('nunca lança quando a gravação falha', async () => {
    prisma.adminAuditLog.create.mockRejectedValue(new Error('banco fora'));

    await expect(
      service.record({ action: 'user.delete', success: true }),
    ).resolves.toBeUndefined();
  });
});
