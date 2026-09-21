import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DiscoveredWork,
  discoveredWorksFrom,
  workUrlFromTitle,
} from './composer-works.parser';
import { ImslpApiClient } from './imslp-api.client';

/** Teto de obras devolvidas por descoberta. */
const MAX_DISCOVERED = 2_000;

export interface DiscoveryResult {
  composer: { id: string; name: string; imslpId: string | null };
  sourceUrl: string;
  /** Obras anunciadas na categoria do IMSLP. */
  found: number;
  /** Já existem no catálogo, casadas por `imslpId`. */
  existing: number;
  /** Ainda não existem — as candidatas à importação. */
  works: (DiscoveredWork & { alreadyImported: boolean })[];
  truncated: boolean;
}

/**
 * Descobre as obras de um compositor no IMSLP.
 *
 * **Só lê.** Nada é gravado: a descoberta responde "o que existe lá e o que já
 * temos", e importar é uma decisão separada. Esse é o ponto certo de
 * separação — a categoria de um compositor grande anuncia mais de mil obras, e
 * importar todas sem revisão é como o catálogo se enche de páginas que não são
 * música.
 *
 * **A leitura da listagem HTML saiu.** Ela via só a primeira página de 200 e
 * identificava a obra pelo nome da página, enquanto o catálogo a identifica
 * pelo id numérico — as duas metades nunca se cruzavam. Quem lista agora é
 * `ImslpApiClient`, que devolve `pageid` e segue a paginação.
 */
@Injectable()
export class ComposerWorksService {
  private readonly logger = new Logger(ComposerWorksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: ImslpApiClient,
  ) {}

  async discover(composerId: string): Promise<DiscoveryResult> {
    const composer = await this.prisma.composer.findUnique({
      where: { id: composerId },
      select: { id: true, name: true, fullName: true, imslpId: true },
    });

    if (!composer) {
      throw new NotFoundException('Compositor não encontrado');
    }

    if (!composer.imslpId) {
      throw new NotFoundException(
        `"${composer.fullName ?? composer.name}" não tem página do IMSLP registrada (\`imslpId\`).`,
      );
    }

    // O `imslpId` do compositor é o nome da categoria dele.
    const { members, truncated } = await this.api.listCategoryMembers(
      composer.imslpId,
    );

    const discovered = discoveredWorksFrom(members);
    const capped = discovered.slice(0, MAX_DISCOVERED);

    // Uma consulta para todas: saber o que já existe obra a obra seria uma
    // consulta por obra, e a categoria de um compositor grande tem mais de mil.
    const known = await this.prisma.work.findMany({
      where: { imslpId: { in: capped.map((work) => work.imslpId) } },
      select: { imslpId: true },
    });

    const imported = new Set(known.map((work) => work.imslpId));

    const works = capped.map((work) => ({
      ...work,
      alreadyImported: imported.has(work.imslpId),
    }));

    const result: DiscoveryResult = {
      composer: {
        id: composer.id,
        name: composer.fullName ?? composer.name,
        imslpId: composer.imslpId,
      },
      sourceUrl: workUrlFromTitle(composer.imslpId),
      found: works.length,
      existing: works.filter((work) => work.alreadyImported).length,
      works,
      // Duas razões para a lista não ser tudo: a categoria não acabou dentro
      // do teto de chamadas, ou acabou e não coube. As duas são a mesma
      // informação para quem lê — "isto não é tudo" — e nenhuma pode ficar
      // calada.
      truncated: truncated || discovered.length > MAX_DISCOVERED,
    };

    this.logger.log(
      `Descoberta em ${composer.imslpId}: ${result.found} obras, ${result.existing} já no catálogo`,
    );

    return result;
  }
}
