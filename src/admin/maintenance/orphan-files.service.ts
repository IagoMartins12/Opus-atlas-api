import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  StorageAssetKind,
  StorageAssetStatus,
  StoredAsset,
} from '@prisma/client';
import { StorageService } from '../../common/storage/storage.service';
import { errorMessage } from '../../common/utils/error.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  idsQueExistem,
  isOwnerType,
  OWNER_TYPES,
  OwnerType,
} from './orphan-owners';

/** Página de leitura do registro de arquivos. */
const PAGINA = 500;

/** Quantos arquivos uma remoção em lote aceita de uma vez. */
export const MAX_REMOCAO = 200;

export interface FiltroDeOrfaos {
  /** ISO; sem `de` e `ate`, todos — o padrão da tela. */
  de?: string;
  ate?: string;
  /**
   * Um tipo de dono, `sem-dono` para os que não declaram dono, ou
   * `video-sem-peca` para vídeos de performance que nenhuma peça usa.
   */
  tipo?: OwnerType | 'sem-dono' | 'video-sem-peca';
}

type Motivo = 'dono-removido' | 'sem-dono' | 'video-sem-peca';

/**
 * Um vídeo recém-enviado fica ativo antes de ser ligado à peça (o envio e a
 * gravação do "já aprendi" são dois passos): só depois de um dia sem peça ele
 * conta como solto, como a limpeza de reservas do armazenamento.
 */
const CARENCIA_DO_VIDEO_MS = 24 * 60 * 60 * 1000;

/**
 * Arquivos órfãos, um a um: a imagem, de onde era, quem enviou, quando,
 * quanto pesa — e a remoção, individual ou em lote.
 *
 * A tarefa agendada (`storage.orphan-sweep`) só conta. Esta é a lista que
 * deixa decidir. **Dois tipos, tratados diferente:** o arquivo cujo dono foi
 * removido é órfão de certeza; o que não declara dono é indeterminado (pode
 * ser de antes do registro de arquivos) e aparece separado.
 *
 * Remover confere de novo cada arquivo antes de apagar: entre a lista e o
 * clique, o dono pode ter voltado (ou o arquivo ter sido religado).
 */
@Injectable()
export class OrphanFilesService {
  private readonly logger = new Logger(OrphanFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private janela(filtro: FiltroDeOrfaos): Prisma.StoredAssetWhereInput {
    if (!filtro.de && !filtro.ate) return {};
    return {
      createdAt: {
        ...(filtro.de ? { gte: new Date(filtro.de) } : {}),
        ...(filtro.ate ? { lte: new Date(filtro.ate) } : {}),
      },
    };
  }

  /** Os órfãos (e, se pedido, os sem dono) que casam com o filtro. */
  private async encontrar(
    filtro: FiltroDeOrfaos,
  ): Promise<Array<{ asset: StoredAsset; motivo: Motivo }>> {
    const achados: Array<{ asset: StoredAsset; motivo: Motivo }> = [];
    const janela = this.janela(filtro);

    if (filtro.tipo !== 'sem-dono' && filtro.tipo !== 'video-sem-peca') {
      const tipos = filtro.tipo ? [filtro.tipo] : OWNER_TYPES;
      for (const tipo of tipos) {
        let cursor: string | undefined;
        for (;;) {
          const pagina = await this.prisma.storedAsset.findMany({
            where: {
              status: StorageAssetStatus.ACTIVE,
              entityType: tipo,
              entityId: { not: null },
              ...janela,
            },
            orderBy: { id: 'asc' },
            take: PAGINA,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (pagina.length === 0) break;
          cursor = pagina[pagina.length - 1].id;

          const vivos = await idsQueExistem(this.prisma, tipo, [
            ...new Set(pagina.map((a) => a.entityId!).filter(Boolean)),
          ]);
          for (const asset of pagina) {
            if (asset.entityId && !vivos.has(asset.entityId)) {
              achados.push({ asset, motivo: 'dono-removido' });
            }
          }
        }
      }
    }

    // Vídeo de performance que nenhuma peça usa: a obra existe (o arquivo
    // aponta para ela), então a busca por dono removido não o acha. Saía assim
    // quando a peça ia de "já aprendi" para "quero aprender" (até 25/10/2026).
    if (!filtro.tipo || filtro.tipo === 'video-sem-peca') {
      const listados = new Set(achados.map((x) => x.asset.id));
      for (const asset of await this.videosSemPeca(janela)) {
        if (!listados.has(asset.id))
          achados.push({ asset, motivo: 'video-sem-peca' });
      }
    }

    if (!filtro.tipo || filtro.tipo === 'sem-dono') {
      const soltos = await this.prisma.storedAsset.findMany({
        where: {
          status: StorageAssetStatus.ACTIVE,
          OR: [{ entityId: null }, { entityId: { isSet: false } }],
          ...janela,
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
      for (const asset of soltos) achados.push({ asset, motivo: 'sem-dono' });
    }

    return achados.sort(
      (a, b) => b.asset.createdAt.getTime() - a.asset.createdAt.getTime(),
    );
  }

  /** Vídeos de performance ativos, com mais de um dia, fora de toda peça. */
  private async videosSemPeca(
    janela: Prisma.StoredAssetWhereInput,
  ): Promise<StoredAsset[]> {
    const videos = await this.prisma.storedAsset.findMany({
      where: {
        status: StorageAssetStatus.ACTIVE,
        kind: StorageAssetKind.PERFORMANCE_VIDEO,
        secureUrl: { not: null },
        ...janela,
        AND: [
          { createdAt: { lt: new Date(Date.now() - CARENCIA_DO_VIDEO_MS) } },
        ],
      },
      take: 5000,
    });
    if (!videos.length) return [];
    const usados = await this.prisma.learned.findMany({
      where: { videoUrl: { in: videos.map((v) => v.secureUrl!) } },
      select: { videoUrl: true },
    });
    const emUso = new Set(usados.map((u) => u.videoUrl));
    return videos.filter((v) => !emUso.has(v.secureUrl));
  }

  async listar(filtro: FiltroDeOrfaos, page = 1, limit = 40) {
    const todos = await this.encontrar(filtro);
    const pagina = todos.slice((page - 1) * limit, page * limit);

    // Quem enviou, pelo nome.
    const donos = [
      ...new Set(pagina.map((x) => x.asset.ownerId).filter(Boolean)),
    ] as string[];
    const pessoas = donos.length
      ? await this.prisma.user.findMany({
          where: { id: { in: donos } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            image: true,
          },
        })
      : [];
    const pessoa = new Map(pessoas.map((p) => [p.id, p]));

    // O nome do registro removido, se a remoção passou pela auditoria.
    const removidos = [
      ...new Set(pagina.map((x) => x.asset.entityId).filter(Boolean)),
    ] as string[];
    const trilha = removidos.length
      ? await this.prisma.adminAuditLog.findMany({
          where: {
            entityId: { in: removidos },
            action: { endsWith: '.delete' },
          },
          select: {
            entityId: true,
            metadata: true,
            createdAt: true,
            actorId: true,
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const remocao = new Map<string, { nome: string | null; em: Date }>();
    for (const t of trilha) {
      if (!t.entityId || remocao.has(t.entityId)) continue;
      const alvo = (t.metadata as { alvo?: unknown } | null)?.alvo;
      remocao.set(t.entityId, {
        nome: typeof alvo === 'string' ? alvo : null,
        em: t.createdAt,
      });
    }

    const porTipo: Record<string, number> = {};
    let bytes = 0;
    for (const { asset, motivo } of todos) {
      const chave = motivo === 'dono-removido' ? asset.entityType! : motivo;
      porTipo[chave] = (porTipo[chave] ?? 0) + 1;
      bytes += asset.bytes ?? 0;
    }

    return {
      items: pagina.map(({ asset, motivo }) => {
        const p = asset.ownerId ? pessoa.get(asset.ownerId) : undefined;
        const r = asset.entityId ? remocao.get(asset.entityId) : undefined;
        return {
          id: asset.id,
          motivo,
          url: asset.secureUrl,
          publicId: asset.publicId,
          tipoDeArquivo: asset.resourceType,
          kind: asset.kind,
          formato: asset.format,
          bytes: asset.bytes,
          largura: asset.width,
          altura: asset.height,
          pasta: asset.folder,
          criadoEm: asset.createdAt,
          dono: asset.entityType
            ? {
                tipo: asset.entityType,
                id: asset.entityId,
                nome: r?.nome ?? null,
                removidoEm: r?.em ?? null,
              }
            : null,
          enviadoPor: asset.ownerId
            ? {
                id: asset.ownerId,
                nome: p
                  ? [p.firstName, p.lastName].filter(Boolean).join(' ') ||
                    p.username ||
                    p.email
                  : null,
                email: p?.email ?? null,
                imagem: p?.image ?? null,
              }
            : null,
        };
      }),
      resumo: { total: todos.length, bytes, porTipo },
      pagination: {
        page,
        limit,
        total: todos.length,
        totalPages: Math.max(1, Math.ceil(todos.length / limit)),
      },
    };
  }

  /** Confere de novo e apaga do provedor; o registro fica como `DELETED`. */
  async remover(ids: string[]) {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) {
      throw new BadRequestException('Escolha ao menos um arquivo.');
    }
    if (unicos.length > MAX_REMOCAO) {
      throw new BadRequestException(
        `No máximo ${MAX_REMOCAO} arquivos por vez.`,
      );
    }

    const assets = await this.prisma.storedAsset.findMany({
      where: { id: { in: unicos }, status: StorageAssetStatus.ACTIVE },
    });

    // Ainda órfão? Agrupa por tipo de dono para conferir de uma vez.
    const porTipo = new Map<OwnerType, string[]>();
    for (const a of assets) {
      if (a.entityType && a.entityId && isOwnerType(a.entityType)) {
        porTipo.set(a.entityType, [
          ...(porTipo.get(a.entityType) ?? []),
          a.entityId,
        ]);
      }
    }
    const vivos = new Set<string>();
    for (const [tipo, donos] of porTipo) {
      for (const id of await idsQueExistem(this.prisma, tipo, donos)) {
        vivos.add(`${tipo}:${id}`);
      }
    }

    // Vídeo de performance: o que decide é estar numa peça, não a obra existir.
    const videos = assets.filter(
      (a) => a.kind === StorageAssetKind.PERFORMANCE_VIDEO && a.secureUrl,
    );
    const videoEmUso = new Set(
      videos.length
        ? (
            await this.prisma.learned.findMany({
              where: { videoUrl: { in: videos.map((v) => v.secureUrl!) } },
              select: { videoUrl: true },
            })
          ).map((u) => u.videoUrl)
        : [],
    );

    const removidos: string[] = [];
    const recusados: Array<{ id: string; motivo: string }> = [];

    for (const a of assets) {
      const ehVideo = a.kind === StorageAssetKind.PERFORMANCE_VIDEO;
      if (ehVideo && videoEmUso.has(a.secureUrl)) {
        recusados.push({ id: a.id, motivo: 'O vídeo está numa peça' });
        continue;
      }
      if (a.entityType && !isOwnerType(a.entityType)) {
        recusados.push({ id: a.id, motivo: 'Tipo de dono desconhecido' });
        continue;
      }
      if (
        !ehVideo &&
        a.entityType &&
        a.entityId &&
        vivos.has(`${a.entityType}:${a.entityId}`)
      ) {
        recusados.push({ id: a.id, motivo: 'O dono existe de novo' });
        continue;
      }
      try {
        await this.storage.deleteAsset(a.id);
        const depois = await this.prisma.storedAsset.findUnique({
          where: { id: a.id },
          select: { status: true },
        });
        if (depois?.status === StorageAssetStatus.DELETED) {
          removidos.push(a.id);
        } else {
          recusados.push({ id: a.id, motivo: 'O armazenamento não confirmou' });
        }
      } catch (error: unknown) {
        this.logger.warn(`Órfão ${a.id} não removido: ${errorMessage(error)}`);
        recusados.push({ id: a.id, motivo: errorMessage(error) });
      }
    }

    for (const id of unicos) {
      if (!assets.some((a) => a.id === id)) {
        recusados.push({ id, motivo: 'Já removido ou não encontrado' });
      }
    }

    return { removidos: removidos.length, ids: removidos, recusados };
  }
}
