import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isMongoId } from 'class-validator';
import { AiTextService, AiUnavailableError } from '../../ai/ai-text.service';
import { CacheNamespace } from '../../common/cache/cache-keys';
import { AppCacheService } from '../../common/cache/cache.service';
import { errorMessage } from '../../common/utils/error.util';
import { localDate } from '../../common/utils/time-zone';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BIO_SYSTEM,
  BioSubject,
  bioPrompt,
  cleanBio,
  hasBio,
  TRANSLATION_SYSTEM,
  translationPrompt,
} from './composer-bio.prompt';

export type BioLanguage = 'pt' | 'en';

export type BiographyResult =
  | {
      biography: string;
      language: BioLanguage;
      source: 'database' | 'generated' | 'translated';
      /** `provedor/modelo`, quando o texto em português saiu da IA. */
      generatedBy: string | null;
    }
  | {
      biography: null;
      language: BioLanguage;
      /** `unavailable`: a IA não conhece o compositor — não adianta insistir. */
      status: 'unavailable' | 'generating';
      retryAfter?: number;
    };

/** Quanto a requisição espera a IA antes de responder "ainda gerando". */
const WAIT_MS = 25_000;

/** Compositor que a IA disse não conhecer não é perguntado de novo tão cedo. */
const UNKNOWN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Gerações simultâneas por processo. */
const MAX_CONCURRENT = 2;

// Folga para o pensamento, que consome do mesmo teto (Claude Opus 5 pensa por
// padrão; o gpt-oss do Groq também raciocina). A cobrança é pelo que é usado,
// não pelo teto — e resposta cortada no teto agora é falha, não biografia.
const BIO_MAX_TOKENS = 8000;
const TRANSLATION_MAX_TOKENS = 8000;

const BUDGET_TIME_ZONE = 'America/Sao_Paulo';
const DAY_MS = 24 * 60 * 60 * 1000;

const unknownKey = (composerId: string) => `ai-bio:unknown:${composerId}`;
const budgetKey = (day: string) => `ai-bio:budget:${day}`;

const BIO_SUBJECT_SELECT = {
  id: true,
  name: true,
  fullName: true,
  alternativeNames: true,
  birthDate: true,
  deathDate: true,
  epochName: true,
  nationality: true,
  instruments: true,
  bio: true,
  bioEn: true,
  bioGeneratedBy: true,
  epoch: { select: { name: true } },
  primaryRole: { select: { name: true } },
} as const;

type BioComposer = {
  id: string;
  name: string;
  fullName: string;
  alternativeNames: string | null;
  birthDate: string | null;
  deathDate: string | null;
  epochName: string | null;
  nationality: string | null;
  instruments: string | null;
  bio: string | null;
  bioEn: string | null;
  bioGeneratedBy: string | null;
  epoch: { name: string } | null;
  primaryRole: { name: string } | null;
};

/**
 * Biografia de compositor — a do banco ou, faltando, gerada por IA e gravada.
 *
 * **O que muda em relação ao legado:**
 *
 * - A versão em inglês fica no banco (`bioEn`), não num JSON dentro do front,
 *   que se perdia a cada deploy e não era visto por outra instância.
 * - **Há teto de custo.** A página do compositor é pública e pede a biografia
 *   sozinha quando não há uma; sem teto, um robô percorrendo os 19 mil
 *   compositores vira a conta do mês. Aqui há teto diário de chamadas
 *   (`AI_BIO_DAILY_LIMIT`), uma geração por compositor por vez, e um limite de
 *   gerações simultâneas.
 * - Compositor que a IA diz não conhecer fica sem biografia — não recebe o
 *   texto genérico que o legado inventava — e não é perguntado de novo por um
 *   mês.
 * - A requisição espera até 25 s. Passando disso, responde `generating` e a
 *   geração continua: o texto fica gravado para a próxima visita, em vez de
 *   se perder num 408.
 */
@Injectable()
export class ComposerBioService {
  private readonly logger = new Logger(ComposerBioService.name);
  private readonly inFlight = new Map<string, Promise<BiographyResult>>();
  private readonly dailyLimit: number;
  private running = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiTextService,
    private readonly cache: AppCacheService,
    config: ConfigService,
  ) {
    this.dailyLimit = config.get<number>('ai.bioDailyLimit') ?? 200;
  }

  async biography(
    composerId: string,
    language: BioLanguage,
    waitMs = WAIT_MS,
  ): Promise<BiographyResult> {
    const composer = isMongoId(composerId)
      ? ((await this.prisma.composer.findUnique({
          where: { id: composerId },
          select: BIO_SUBJECT_SELECT,
        })) as BioComposer | null)
      : null;

    if (!composer) {
      throw new NotFoundException('Compositor não encontrado');
    }

    const stored = language === 'pt' ? composer.bio : composer.bioEn;

    if (hasBio(stored)) {
      return {
        biography: stored.trim(),
        language,
        source: 'database',
        generatedBy: composer.bioGeneratedBy,
      };
    }

    // Já se sabe que a IA não conhece — só vale para quem ainda precisa gerar
    // o português; a tradução de um texto existente sempre é possível.
    if (
      !hasBio(composer.bio) &&
      (await this.cache.get(unknownKey(composer.id)))
    ) {
      return { biography: null, language, status: 'unavailable' };
    }

    const key = `${composer.id}:${language}`;
    let job = this.inFlight.get(key);

    if (!job) {
      job = this.produce(composer, language).finally(() => {
        this.inFlight.delete(key);
      });
      this.inFlight.set(key, job);
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), waitMs);
    });

    try {
      const result = await Promise.race([job, timeout]);
      return (
        result ?? {
          biography: null,
          language,
          status: 'generating',
          retryAfter: 15,
        }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Rascunho para quem está cadastrando o compositor — ainda sem id, então
   * nada é gravado: o texto volta ao formulário e é salvo junto com o resto.
   * Mesmo teto diário e mesmo limite de gerações simultâneas.
   */
  async draft(
    subject: BioSubject,
    language: BioLanguage,
  ): Promise<BiographyResult> {
    const completion = await this.call({
      system: BIO_SYSTEM,
      prompt: bioPrompt(subject),
      maxTokens: BIO_MAX_TOKENS,
    });
    const portuguese = cleanBio(completion.text);

    if (!portuguese) {
      return { biography: null, language, status: 'unavailable' };
    }

    return {
      biography:
        language === 'pt' ? portuguese : await this.translateText(portuguese),
      language,
      source: 'generated',
      generatedBy: completion.generatedBy,
    };
  }

  /** Traduz para o inglês um texto em português do formulário, sem gravar. */
  async translateText(portuguese: string): Promise<string> {
    const completion = await this.call({
      system: TRANSLATION_SYSTEM,
      prompt: translationPrompt(portuguese),
      maxTokens: TRANSLATION_MAX_TOKENS,
    });

    return completion.text.trim();
  }

  // -------------------------------------------------------------------

  private async produce(
    composer: BioComposer,
    language: BioLanguage,
  ): Promise<BiographyResult> {
    let portuguese = hasBio(composer.bio) ? composer.bio.trim() : null;
    let generatedBy = composer.bioGeneratedBy;
    let generatedNow = false;

    if (!portuguese) {
      const generated = await this.generatePortuguese(composer);

      if (!generated) {
        return { biography: null, language, status: 'unavailable' };
      }

      portuguese = generated.text;
      generatedBy = generated.generatedBy;
      generatedNow = true;
    }

    if (language === 'pt') {
      return {
        biography: portuguese,
        language,
        source: 'generated',
        generatedBy,
      };
    }

    const english = await this.translate(composer.id, portuguese);

    return {
      biography: english,
      language,
      source: generatedNow ? 'generated' : 'translated',
      generatedBy,
    };
  }

  private async generatePortuguese(
    composer: BioComposer,
  ): Promise<{ text: string; generatedBy: string } | null> {
    const completion = await this.call({
      system: BIO_SYSTEM,
      prompt: bioPrompt({
        name: composer.name,
        fullName: composer.fullName,
        alternativeNames: composer.alternativeNames,
        birthDate: composer.birthDate,
        deathDate: composer.deathDate,
        epochName: composer.epoch?.name ?? composer.epochName,
        roleName: composer.primaryRole?.name,
        nationality: composer.nationality,
        instruments: composer.instruments,
      }),
      maxTokens: BIO_MAX_TOKENS,
    });

    const text = cleanBio(completion.text);

    if (!text) {
      await this.cache.set(unknownKey(composer.id), true, UNKNOWN_TTL_MS);
      this.logger.log(
        `Biografia: ${completion.generatedBy} não conhece o compositor ${composer.id}`,
      );
      return null;
    }

    await this.prisma.composer.update({
      where: { id: composer.id },
      data: {
        bio: text,
        bioGeneratedBy: completion.generatedBy,
        bioGeneratedAt: new Date(),
      },
    });
    await this.forgetDetail(composer.id);

    return { text, generatedBy: completion.generatedBy };
  }

  private async translate(composerId: string, portuguese: string) {
    const completion = await this.call({
      system: TRANSLATION_SYSTEM,
      prompt: translationPrompt(portuguese),
      maxTokens: TRANSLATION_MAX_TOKENS,
    });
    const english = completion.text.trim();

    await this.prisma.composer.update({
      where: { id: composerId },
      data: { bioEn: english },
    });
    await this.forgetDetail(composerId);

    return english;
  }

  /** Uma chamada à IA, dentro do teto diário e do limite de simultâneas. */
  private async call(request: {
    system: string;
    prompt: string;
    maxTokens: number;
  }) {
    if (!this.ai.enabled) {
      throw new ServiceUnavailableException(
        'Biografia por IA indisponível: nenhum provedor configurado',
      );
    }

    if (this.running >= MAX_CONCURRENT) {
      throw new ServiceUnavailableException(
        'Muitas biografias sendo geradas agora. Tente em instantes.',
      );
    }

    const day = localDate(new Date(), BUDGET_TIME_ZONE);
    const used = (await this.cache.get<number>(budgetKey(day))) ?? 0;

    if (used >= this.dailyLimit) {
      throw new HttpException(
        'Limite diário de biografias geradas atingido. Tente amanhã.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Conta antes de chamar: a chamada custa mesmo quando falha.
    await this.cache.set(budgetKey(day), used + 1, 2 * DAY_MS);
    this.running++;

    try {
      return await this.ai.complete(request);
    } catch (error: unknown) {
      if (error instanceof AiUnavailableError) {
        this.logger.warn(`Biografia: ${errorMessage(error)}`);
        throw new ServiceUnavailableException(
          'Biografia por IA indisponível no momento',
        );
      }
      throw error;
    } finally {
      this.running--;
    }
  }

  private async forgetDetail(composerId: string): Promise<void> {
    await this.cache.del(`${CacheNamespace.COMPOSERS}:detail:${composerId}`);
  }
}
