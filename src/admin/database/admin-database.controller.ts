import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { Audited } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AdminDatabaseService } from './admin-database.service';
import {
  CreateRecordDto,
  DeleteRecordsDto,
  DescribeModelQueryDto,
  ExportRecordsQueryDto,
  ListRecordsQueryDto,
  UpdateRecordDto,
} from './dto/admin-database.dto';

/**
 * Acesso direto ao banco.
 *
 * **A superfície mais sensível da plataforma.** Exige JWT de super admin.
 * Até 15/09/2026 exigia também `x-api-key`, como segunda autenticação; a chave
 * não pode ir ao navegador, o que deixava o estúdio do painel preso à rota do
 * legado (sem confirmação e sem trilha). Por decisão do usuário, a chave saiu:
 * o risco de uma sessão de super admin comprometida ler ou reescrever a base
 * foi aceito, e o que segura o acesso são o papel, a frase de confirmação por
 * alvo, a política de campos e a trilha de antes e depois.
 *
 * **A escrita genérica contorna toda regra de negócio da plataforma.** As
 * validações de papel, a proteção do último super admin, os limites de plano,
 * as regras de cupom, as checagens de dono — nada disso passa por aqui. Foi
 * decisão deliberada mantê-la, e o que o código faz é garantir que nada
 * aconteça por acidente e que tudo fique registrado: frase de confirmação
 * citando o alvo, campos validados contra o schema, campos protegidos
 * recusados, e a trilha guardando o antes e o depois de cada campo.
 *
 * **O que o legado fazia aqui:** `prismaModel.create({ data })`,
 * `update({ where: { id }, data })` e `deleteMany` com o corpo cru da
 * requisição, sobre qualquer um dos 70 models, sem confirmação e sem trilha.
 * Bastava um `PUT` para se promover a super admin.
 */
@ApiTags('admin-database')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin/database')
export class AdminDatabaseController {
  constructor(private readonly database: AdminDatabaseService) {}

  @Get('models')
  @Audited({ action: 'database.models.list' })
  @ApiOperation({
    summary: 'Models do schema, com contagem',
    description:
      'Vem do DMMF, a mesma fonte que gerou o cliente. O legado mantinha um ' +
      'mapa de 70 entradas escrito à mão, duplicado em dois arquivos, e a ' +
      'resposta carregava nome de ícone do `react-icons` junto do dado.',
  })
  @ApiOkResponse({ description: 'Models, com quantos campos são protegidos' })
  async models() {
    return this.database.listModels();
  }

  @Get('schema')
  @Audited({ action: 'database.schema.read' })
  @ApiOperation({
    summary: 'Campos de um model',
    description:
      'Diz o que é legível, o que é escrevível e o que é protegido. Aqui ' +
      '`isProtected` não é aviso: o campo é recusado na leitura, no filtro, ' +
      'na ordenação e na escrita.',
  })
  @ApiOkResponse({ description: 'Campos com tipo e permissões' })
  @ApiBadRequestResponse({
    description: 'Model desconhecido',
    type: ErrorResponseDto,
  })
  describe(@Query() query: DescribeModelQueryDto) {
    return this.database.describeModel(query.model);
  }

  @Get('records')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Audited({ action: 'database.records.read' })
  @ApiOperation({
    summary: 'Lê registros de um model',
    description:
      'Campos protegidos nunca saem, filtros seguem gramática fechada e a ' +
      'página é limitada a 200. No legado, `?model=user` sem parâmetros ' +
      'devolvia `hashedPassword` de toda a base, porque sem `fields` o ' +
      '`select` ficava `undefined`; e `filters` era `JSON.parse` da query ' +
      'espalhado direto no `where` do Prisma.',
  })
  @ApiOkResponse({ description: 'Registros paginados' })
  @ApiBadRequestResponse({
    description: 'Model, campo, operador ou valor inválido',
    type: ErrorResponseDto,
  })
  async records(@Query() query: ListRecordsQueryDto) {
    return this.database.listRecords({
      model: query.model,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 25,
      search: query.search,
      filters: query.filters,
      fields: query.fields,
      sortField: query.sortField,
      sortDirection: query.sortDirection ?? 'desc',
    });
  }

  @Get('export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Audited({ action: 'database.export' })
  @ApiProduces('application/json', 'text/csv')
  @ApiOperation({
    summary: 'Exporta registros de um model',
    description:
      'Mesma política de campos da leitura, com teto de 50 mil linhas. O CSV ' +
      'neutraliza fórmula (`=`, `+`, `-`, `@`) — o do legado só escapava ' +
      'aspas, então uma célula vinda do cadastro público virava fórmula ' +
      'executada ao abrir a planilha. Exportar é, ele próprio, auditado.',
  })
  @ApiOkResponse({ description: 'JSON ou CSV' })
  async export(
    @Query() query: ExportRecordsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.database.exportRecords({
      model: query.model,
      format: query.format ?? 'json',
      search: query.search,
      filters: query.filters,
      fields: query.fields,
      sortField: query.sortField,
      sortDirection: query.sortDirection ?? 'desc',
    });

    if (typeof result === 'string') {
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${query.model}.csv"`,
      );
    }

    return result;
  }

  @Post('records')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audited({ action: 'database.record.create.attempt' })
  @ApiOperation({
    summary: 'Cria um registro',
    description:
      'Exige `confirmation` igual a `CRIAR <Model>`. Contorna as regras de ' +
      'negócio do model por definição — a trilha guarda o que foi escrito.',
  })
  @ApiOkResponse({ description: 'Registro criado' })
  @ApiBadRequestResponse({
    description: 'Confirmação incorreta, campo desconhecido ou protegido',
    type: ErrorResponseDto,
  })
  async create(
    @Body() dto: CreateRecordDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.database.createRecord({
      model: dto.model,
      data: dto.data,
      confirmation: dto.confirmation,
      actor: { actorId: user.sub, actorRole: String(user.role) },
    });
  }

  @Patch('records/:model/:id')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audited({
    action: 'database.record.update.attempt',
    entityType: 'databaseRecord',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Altera um registro',
    description:
      'Exige `confirmation` igual a `ATUALIZAR <Model> <id>`. Lê o estado ' +
      'anterior antes de escrever e registra o antes e o depois de cada ' +
      'campo — numa rota capaz de promover uma conta a super admin, é o "de 0 ' +
      'para 2" que responde à pergunta numa investigação.',
  })
  @ApiOkResponse({ description: 'Registro alterado, com o diff dos campos' })
  @ApiNotFoundResponse({
    description: 'Registro inexistente',
    type: ErrorResponseDto,
  })
  async update(
    @Param('model') model: string,
    @Param('id') id: string,
    @Body() dto: UpdateRecordDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.database.updateRecord({
      model,
      id,
      data: dto.data,
      confirmation: dto.confirmation,
      actor: { actorId: user.sub, actorRole: String(user.role) },
    });
  }

  @Delete('records')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Audited({ action: 'database.record.delete.attempt' })
  @ApiOperation({
    summary: 'Apaga registros por id',
    description:
      'Exige `confirmation` igual a `APAGAR <n> <Model>` — a confirmação de ' +
      'apagar 3 não serve para apagar 300. No máximo 100 por chamada, e a ' +
      'trilha guarda o conteúdo apagado, que é a única cópia que resta.',
  })
  @ApiOkResponse({
    description: 'Quantos foram apagados e quantos não existiam',
  })
  @ApiBadRequestResponse({
    description: 'Confirmação incorreta ou lista fora do limite',
    type: ErrorResponseDto,
  })
  async remove(
    @Body() dto: DeleteRecordsDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.database.deleteRecords({
      model: dto.model,
      ids: dto.ids,
      confirmation: dto.confirmation,
      actor: { actorId: user.sub, actorRole: String(user.role) },
    });
  }
}
