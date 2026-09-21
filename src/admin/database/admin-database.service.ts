import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { toCsv } from '../../common/utils/csv.util';
import { toJsonInput } from '../../common/utils/json.util';
import { buildSelect, readableFields } from './field-policy';
import { ModelInfo, ModelRegistry } from './model-registry';
import { buildOrderBy, buildWhere, RecordFilter } from './record-query';
import {
  assertConfirmation,
  assertWritableData,
  createPhrase,
  deletePhrase,
  diffFields,
  updatePhrase,
} from './write-guard';

/**
 * Teto de linhas por página.
 *
 * O legado lia `parseInt(searchParams.get('pageSize') || '25')` sem teto:
 * `pageSize=1000000` devolvia a coleção inteira numa resposta só — e, para
 * `model=user`, a coleção inteira incluía os hashes de senha.
 */
const MAX_PAGE_SIZE = 200;

/** Teto de linhas na exportação. */
const MAX_EXPORT_ROWS = 50_000;

/** Teto de registros apagados numa chamada. */
const MAX_DELETE_IDS = 100;

export interface ActorContext {
  actorId: string;
  actorRole: string;
}

@Injectable()
export class AdminDatabaseService {
  private readonly logger = new Logger(AdminDatabaseService.name);

  constructor(
    private readonly registry: ModelRegistry,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------

  /**
   * Os models do schema, com contagem.
   *
   * **Sem nome de ícone na resposta.** O legado devolvia
   * `icon: 'FiUsers'` — nome de componente do `react-icons` — junto do dado, o
   * que amarra a API a uma biblioteca de interface de um cliente específico.
   * Categoria e rótulo em português também saíram: são decisões de
   * apresentação, e o front já sabe traduzir `NewsletterCampaign`.
   */
  async listModels() {
    const models = this.registry.list();

    const counted = await Promise.all(
      models.map(async (model) => {
        const readable = readableFields(model.fields);

        return {
          name: model.name,
          fields: model.fields.length,
          readableFields: readable.length,
          protectedFields: model.fields.length - readable.length,
          records: await this.safeCount(model),
        };
      }),
    );

    return { models: counted, total: counted.length };
  }

  /** Campos de um model, com o que é legível, filtrável e escrevível. */
  describeModel(modelName: string) {
    const model = this.registry.require(modelName);

    return {
      name: model.name,
      idField: model.idField,
      fields: model.fields.map((field) => ({
        name: field.name,
        type: field.type,
        kind: field.kind,
        isList: field.isList,
        isRequired: field.isRequired,
        isId: field.isId,
        // Protegido não aparece só como aviso: ele é recusado na leitura, no
        // filtro, na ordenação e na escrita.
        isProtected: field.isSecret,
        isWritable:
          !field.isSecret && !field.isId && !this.isManaged(field.name),
      })),
    };
  }

  async listRecords(input: {
    model: string;
    page: number;
    pageSize: number;
    search?: string;
    filters?: RecordFilter[];
    fields?: string[];
    sortField?: string;
    sortDirection: 'asc' | 'desc';
  }) {
    const model = this.registry.require(input.model);
    const delegate = this.registry.delegate(model);

    const pageSize = Math.min(input.pageSize, MAX_PAGE_SIZE);
    const where = buildWhere(this.registry, model, input);
    const select = buildSelect(model.fields, input.fields);
    const orderBy = buildOrderBy(
      this.registry,
      model,
      input.sortField,
      input.sortDirection,
    );

    const [records, total] = await Promise.all([
      delegate.findMany({
        where,
        select,
        orderBy,
        skip: (input.page - 1) * pageSize,
        take: pageSize,
      }),
      delegate.count({ where }),
    ]);

    return {
      model: model.name,
      records,
      pagination: {
        page: input.page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      // Diz na resposta o que ficou de fora, para o cliente não achar que o
      // model tem só estes campos.
      protectedFields: model.fields
        .filter((field) => field.isSecret)
        .map((field) => field.name),
    };
  }

  async exportRecords(input: {
    model: string;
    format: 'json' | 'csv';
    search?: string;
    filters?: RecordFilter[];
    fields?: string[];
    sortField?: string;
    sortDirection: 'asc' | 'desc';
  }) {
    const model = this.registry.require(input.model);
    const delegate = this.registry.delegate(model);

    const select = buildSelect(model.fields, input.fields);

    const records = await delegate.findMany({
      where: buildWhere(this.registry, model, input),
      select,
      orderBy: buildOrderBy(
        this.registry,
        model,
        input.sortField,
        input.sortDirection,
      ),
      take: MAX_EXPORT_ROWS,
    });

    if (input.format === 'json') {
      return {
        model: model.name,
        records,
        count: records.length,
        truncated: records.length >= MAX_EXPORT_ROWS,
        exportedAt: new Date(),
      };
    }

    const headers = Object.keys(select);

    // `toCsv` neutraliza fórmula (`=`, `+`, `-`, `@`). O `jsonToCsv` do legado
    // só escapava aspas: uma célula começando com `=` vira fórmula executada
    // quando o arquivo é aberto na planilha de quem exportou.
    return toCsv(
      headers,
      records.map((record) => headers.map((header) => record[header])),
    );
  }

  // -------------------------------------------------------------------
  // Escrita
  // -------------------------------------------------------------------

  /**
   * Cria um registro.
   *
   * A escrita genérica passa por fora de toda regra de negócio da plataforma, e
   * isso é decisão tomada. O que sobra ao código é **tornar impossível fazer
   * sem querer, e impossível fazer sem deixar rastro**: frase de confirmação
   * citando o alvo, campos validados contra o schema, campos protegidos
   * recusados, e auditoria com o conteúdo escrito.
   */
  async createRecord(input: {
    model: string;
    data: Record<string, unknown>;
    confirmation?: string;
    actor: ActorContext;
  }) {
    const model = this.registry.require(input.model);

    assertConfirmation(createPhrase(model), input.confirmation);
    assertWritableData(this.registry, model, input.data);

    const created = await this.registry.delegate(model).create({
      data: input.data,
      select: buildSelect(model.fields),
    });

    await this.recordAudit(input.actor, 'database.record.create', model, {
      entityId: String(created[model.idField] ?? ''),
      metadata: { written: input.data },
    });

    this.logger.warn(
      `Escrita direta: ${input.actor.actorId} criou ${model.name} ${String(created[model.idField])}`,
    );

    return { model: model.name, record: created };
  }

  /**
   * Atualiza um registro.
   *
   * Lê o estado anterior **antes** de escrever, para que a trilha guarde o
   * campo, o valor de antes e o de depois. Sem isso a auditoria registra que
   * houve escrita, não o que mudou — e numa rota capaz de promover uma conta a
   * super admin, é o "de 0 para 2" que responde a pergunta.
   */
  async updateRecord(input: {
    model: string;
    id: string;
    data: Record<string, unknown>;
    confirmation?: string;
    actor: ActorContext;
  }) {
    const model = this.registry.require(input.model);
    const delegate = this.registry.delegate(model);

    assertConfirmation(updatePhrase(model, input.id), input.confirmation);
    const touched = assertWritableData(this.registry, model, input.data);

    const select = buildSelect(model.fields);

    const before = await delegate.findUnique({
      where: { [model.idField]: input.id },
      select,
    });

    if (!before) {
      throw new NotFoundException(`${model.name} ${input.id} não encontrado.`);
    }

    const after = await delegate.update({
      where: { [model.idField]: input.id },
      data: input.data,
      select,
    });

    const changes = diffFields(before, after, touched);

    await this.recordAudit(input.actor, 'database.record.update', model, {
      entityId: input.id,
      metadata: { changes },
    });

    this.logger.warn(
      `Escrita direta: ${input.actor.actorId} alterou ${model.name} ${input.id} — ` +
        changes.map((change) => change.field).join(', '),
    );

    return { model: model.name, record: after, changes };
  }

  /**
   * Apaga registros por id.
   *
   * A frase de confirmação cita **o model e a quantidade**, então a confirmação
   * de apagar 3 não serve para apagar 300. O legado aceitava `ids` de qualquer
   * tamanho, sem confirmação e sem trilha.
   *
   * A trilha guarda o conteúdo do que foi apagado — é a única cópia que resta.
   */
  async deleteRecords(input: {
    model: string;
    ids: string[];
    confirmation?: string;
    actor: ActorContext;
  }) {
    const model = this.registry.require(input.model);
    const delegate = this.registry.delegate(model);

    if (input.ids.length === 0 || input.ids.length > MAX_DELETE_IDS) {
      throw new BadRequestException(
        `Informe de 1 a ${MAX_DELETE_IDS} identificadores.`,
      );
    }

    assertConfirmation(
      deletePhrase(model, input.ids.length),
      input.confirmation,
    );

    const select = buildSelect(model.fields);

    const doomed = await delegate.findMany({
      where: { [model.idField]: { in: input.ids } },
      select,
    });

    const result = await delegate.deleteMany({
      where: { [model.idField]: { in: input.ids } },
    });

    await this.recordAudit(input.actor, 'database.record.delete', model, {
      metadata: { deletedCount: result.count, deleted: doomed },
    });

    this.logger.warn(
      `Escrita direta: ${input.actor.actorId} apagou ${result.count} de ${model.name}`,
    );

    return {
      model: model.name,
      deletedCount: result.count,
      // Quantos ids não existiam: apagar 5 e receber 3 merece explicação.
      notFound: input.ids.length - result.count,
    };
  }

  // -------------------------------------------------------------------

  private isManaged(fieldName: string): boolean {
    return fieldName === 'createdAt' || fieldName === 'updatedAt';
  }

  private async recordAudit(
    actor: ActorContext,
    action: string,
    model: ModelInfo,
    extra: { entityId?: string; metadata: Record<string, unknown> },
  ): Promise<void> {
    await this.audit.record({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action,
      entityType: model.name,
      entityId: extra.entityId,
      metadata: toJsonInput({
        model: model.name,
        ...extra.metadata,
      }) as Prisma.InputJsonValue,
      success: true,
    });
  }

  /**
   * Contagem que não derruba a listagem.
   *
   * Um model que existe no schema e não no banco (ou sem permissão de leitura)
   * devolve `null`, não zero: zero é uma afirmação sobre o conteúdo, e aqui não
   * se sabe nada sobre o conteúdo. O legado devolvia `count: 0` nos dois casos.
   */
  private async safeCount(model: ModelInfo): Promise<number | null> {
    try {
      return await this.registry.delegate(model).count({});
    } catch (error: unknown) {
      this.logger.warn(
        `Não foi possível contar ${model.name}: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
