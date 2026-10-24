import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { escapeRegex } from '../../common/utils/regex.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ListSupportTicketsQueryDto,
  UpdateSupportTicketDto,
} from './dto/support-tickets.dto';

const PAGE = 30;

/**
 * Atendimento: as mensagens do formulário de contato. **Prioritário primeiro**:
 * entre os abertos, quem tem suporte prioritário (do Plus em diante) vem antes,
 * e dentro de cada grupo o mais antigo antes — é a fila de quem espera há mais
 * tempo. Prazo prometido: até 1 dia útil para planos pagos, 3 para o Free.
 */
@Injectable()
export class SupportTicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListSupportTicketsQueryDto) {
    const status = query.status ?? 'open';
    const page = query.page ?? 1;
    const term = query.search?.trim();
    const where: Prisma.SupportTicketWhereInput = {
      ...(status === 'all' ? {} : { status }),
      ...(term
        ? {
            OR: [
              { email: { contains: escapeRegex(term), mode: 'insensitive' } },
              { name: { contains: escapeRegex(term), mode: 'insensitive' } },
              { subject: { contains: escapeRegex(term), mode: 'insensitive' } },
              {
                ticketId: { contains: escapeRegex(term), mode: 'insensitive' },
              },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.SupportTicketOrderByWithRelationInput[] =
      status === 'open'
        ? [{ prioritySupport: 'desc' }, { createdAt: 'asc' }]
        : [{ createdAt: 'desc' }];

    const [tickets, total, counts, priorityOpen] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        orderBy,
        skip: (page - 1) * PAGE,
        take: PAGE,
      }),
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.supportTicket.count({
        where: { status: 'open', prioritySupport: true },
      }),
    ]);

    return {
      tickets,
      counts: {
        open: counts.find((c) => c.status === 'open')?._count._all ?? 0,
        answered: counts.find((c) => c.status === 'answered')?._count._all ?? 0,
        closed: counts.find((c) => c.status === 'closed')?._count._all ?? 0,
        priorityOpen,
      },
      pagination: {
        page,
        limit: PAGE,
        total,
        totalPages: Math.ceil(total / PAGE),
      },
    };
  }

  async update(id: string, dto: UpdateSupportTicketDto) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
    });
    if (!ticket) throw new NotFoundException('Chamado não encontrado');
    return this.prisma.supportTicket.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.status === 'answered' && !ticket.answeredAt
          ? { answeredAt: new Date() }
          : {}),
      },
    });
  }
}
