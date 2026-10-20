import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LessonStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { buildCalendar, type IcsLesson } from './ics';

const DAY_MS = 86_400_000;
/** O que a assinatura cobre: um pouco do passado e um ano à frente. */
const FEED_PAST_DAYS = 60;
const FEED_FUTURE_DAYS = 365;
/** Download avulso: no máximo um ano por arquivo. */
const MAX_DOWNLOAD_DAYS = 366;

const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');
const nameOf = (
  u: { firstName: string | null; lastName: string | null } | null | undefined,
) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() : '');

/**
 * Calendário do portal para fora do portal (04/10/2026): a assinatura e o
 * download em .ics.
 *
 * **O link da assinatura é a credencial**, porque o Google e a Apple buscam o
 * calendário sem login. Por isso o token é aleatório (32 bytes), só o hash
 * fica no banco, e gerar um novo derruba o antigo — quem compartilhou o link
 * sem querer resolve com um clique.
 */
@Injectable()
export class CalendarFeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async status(userId: string) {
    const feed = await this.prisma.calendarFeed.findUnique({
      where: { userId },
      select: { createdAt: true, lastUsedAt: true },
    });
    return {
      active: !!feed,
      createdAt: feed?.createdAt ?? null,
      lastUsedAt: feed?.lastUsedAt ?? null,
    };
  }

  /**
   * Gera (ou troca) o link. O token só aparece aqui, uma vez. O endereço
   * público é do site (`/calendar-feed/{token}.ics`, que repassa para cá): é o
   * domínio que a pessoa reconhece na lista de calendários dela.
   */
  async rotate(userId: string) {
    const token = crypto.randomBytes(32).toString('base64url');
    await this.prisma.calendarFeed.upsert({
      where: { userId },
      create: { userId, tokenHash: hashToken(token) },
      update: {
        tokenHash: hashToken(token),
        createdAt: new Date(),
        lastUsedAt: null,
      },
    });
    return {
      token,
      path: `/calendar-feed/${token}.ics`,
      createdAt: new Date(),
    };
  }

  async revoke(userId: string) {
    await this.prisma.calendarFeed.deleteMany({ where: { userId } });
  }

  /** O calendário de quem tem o token — rota pública. */
  async feed(token: string): Promise<string> {
    const clean = token.replace(/\.ics$/i, '');
    const feed = await this.prisma.calendarFeed.findUnique({
      where: { tokenHash: hashToken(clean) },
      select: { id: true, userId: true, lastUsedAt: true },
    });
    if (!feed) throw new NotFoundException('Calendário não encontrado');

    // Marca o uso no máximo de hora em hora: o cliente relê com frequência.
    if (
      !feed.lastUsedAt ||
      Date.now() - feed.lastUsedAt.getTime() > 3_600_000
    ) {
      await this.prisma.calendarFeed.update({
        where: { id: feed.id },
        data: { lastUsedAt: new Date() },
      });
    }

    const now = Date.now();
    const lessons = await this.lessonsOf(
      feed.userId,
      new Date(now - FEED_PAST_DAYS * DAY_MS),
      new Date(now + FEED_FUTURE_DAYS * DAY_MS),
    );
    return buildCalendar({ name: 'Opus Atlas — aulas', lessons });
  }

  /** Download de um período (ou de uma aula) — rota autenticada. */
  async download(
    userId: string,
    query: { from?: string; to?: string; lessonId?: string },
  ) {
    const from = query.from ? new Date(query.from) : new Date();
    let to = query.to
      ? new Date(query.to)
      : new Date(from.getTime() + 31 * DAY_MS);
    if (to.getTime() - from.getTime() > MAX_DOWNLOAD_DAYS * DAY_MS) {
      to = new Date(from.getTime() + MAX_DOWNLOAD_DAYS * DAY_MS);
    }
    const lessons = await this.lessonsOf(userId, from, to, query.lessonId);
    if (query.lessonId && lessons.length === 0)
      throw new NotFoundException('Aula não encontrada');
    return buildCalendar({ name: 'Opus Atlas — aulas', lessons });
  }

  /**
   * Aulas de quem é professor ou aluno nelas (os dois papéis juntos): quem
   * dá aula e também estuda vê tudo num calendário só.
   */
  private async lessonsOf(
    userId: string,
    from: Date,
    to: Date,
    lessonId?: string,
  ): Promise<IcsLesson[]> {
    const rows = await this.prisma.lesson.findMany({
      where: {
        ...(lessonId
          ? { id: lessonId }
          : { scheduledAt: { gte: from, lt: to } }),
        status: { not: LessonStatus.RESCHEDULED },
        OR: [{ teacher: { is: { userId } } }, { student: { is: { userId } } }],
      },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        duration: true,
        status: true,
        location: true,
        objectives: true,
        publicNotes: true,
        updatedAt: true,
        teacher: {
          select: {
            userId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
        student: {
          select: {
            userId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 2000,
    });

    const site = (
      this.config.get<string>('mediaSearch.frontendBaseUrl') ?? ''
    ).replace(/\/$/, '');
    return rows.map((l) => {
      const asTeacher = l.teacher.userId === userId;
      const other = nameOf(asTeacher ? l.student.user : l.teacher.user);
      const description = [
        l.objectives.length ? `Objetivos: ${l.objectives.join('; ')}` : '',
        l.publicNotes ?? '',
      ]
        .filter(Boolean)
        .join('\n');
      return {
        id: l.id,
        title: l.title,
        scheduledAt: l.scheduledAt,
        duration: l.duration,
        status: l.status,
        location: l.location,
        description: description || null,
        updatedAt: l.updatedAt,
        counterpart: other ? `com ${other}` : null,
        url: site
          ? `${site}/${asTeacher ? 'teacher' : 'student'}/lessons/${l.id}`
          : null,
      };
    });
  }
}
