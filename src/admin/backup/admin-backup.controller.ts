import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Audited } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Roles } from '../../common/decorators/roles.decorator';
import { BackupSettingsService } from './backup-settings.service';
import { BackupStorageService } from './backup-storage.service';
import { BackupHistoryService } from './backup-history.service';
import {
  BackupAvailableCollectionDto,
  BackupDownloadDto,
  BackupFileDto,
  BackupRunDto,
  BackupSettingsResponseDto,
  UpdateBackupSettingsDto,
} from './dto/backup.dto';

/**
 * Backup do banco.
 *
 * **Rodar o backup não é uma rota daqui.** Ele é uma tarefa do catálogo de
 * manutenção (`database.backup`), disparada por
 * `POST /admin/maintenance/tasks/database.backup/run` e agendável por
 * `PUT /admin/maintenance/schedules/database.backup`. Assim o backup herda o
 * que já existe: execução fora da requisição, estado do job consultável,
 * agendamento durável e a mesma tela de cron das outras tarefas.
 *
 * Aqui ficam só a configuração, o histórico e os arquivos.
 */
@ApiTags('admin-backup')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin/backup')
export class AdminBackupController {
  constructor(
    private readonly settings: BackupSettingsService,
    private readonly storage: BackupStorageService,
    private readonly history: BackupHistoryService,
  ) {}

  @Get('collections')
  @ApiOperation({
    summary: 'Coleções que podem entrar no backup',
    description:
      'Sai do próprio schema, com a contagem atual de cada uma — model novo ' +
      'aparece aqui sozinho.',
  })
  @ApiOkResponse({ type: [BackupAvailableCollectionDto] })
  async colecoes(): Promise<BackupAvailableCollectionDto[]> {
    return this.settings.listarColecoes();
  }

  @Get('settings')
  @ApiOperation({ summary: 'Configuração do backup' })
  @ApiOkResponse({ type: BackupSettingsResponseDto })
  async lerConfiguracao(): Promise<BackupSettingsResponseDto> {
    const configuracao = await this.settings.ler();

    return { ...configuracao, storageIssue: this.storage.diagnostico };
  }

  @Put('settings')
  @Audited({ action: 'backup.settings.update', entityType: 'backup-settings' })
  @ApiOperation({
    summary: 'Define o que entra no backup e quantos arquivos manter',
    description:
      'Coleção fora da lista não entra no arquivo. `limit` nulo é "tudo".',
  })
  @ApiOkResponse({ type: BackupSettingsResponseDto })
  async gravarConfiguracao(
    @Body() dto: UpdateBackupSettingsDto,
    @CurrentUser() usuario: AccessTokenPayload,
  ): Promise<BackupSettingsResponseDto> {
    // Nome que não existe leria zero documentos sem erro nenhum, e o backup
    // sairia menor com cara de sucesso. Recusar aqui é o único momento em que
    // dá para avisar antes de o estrago ficar invisível.
    const conhecidas = new Set(
      (await this.settings.listarColecoes()).map((colecao) => colecao.name),
    );
    const desconhecidas = dto.collections
      .map((colecao) => colecao.name)
      .filter((nome) => !conhecidas.has(nome));

    if (desconhecidas.length > 0) {
      throw new BadRequestException(
        `Coleção inexistente: ${desconhecidas.join(', ')}.`,
      );
    }

    const configuracao = await this.settings.gravar(
      {
        keep: dto.keep,
        collections: dto.collections.map((colecao) => ({
          name: colecao.name,
          limit: colecao.limit ?? null,
        })),
      },
      usuario.sub,
    );

    return { ...configuracao, storageIssue: this.storage.diagnostico };
  }

  @Get('runs')
  @ApiOperation({
    summary: 'Histórico de execuções',
    description:
      'Guardar o resultado é o que separa "temos backup" de "achamos que ' +
      'temos": aqui aparece se o arquivo foi verificado depois de enviado.',
  })
  @ApiOkResponse({ type: [BackupRunDto] })
  async execucoes(@Query('limit') limit?: string): Promise<BackupRunDto[]> {
    const quantos = Number(limit);

    return this.history.listar(
      Number.isFinite(quantos) && quantos > 0 ? Math.min(quantos, 100) : 20,
    );
  }

  @Get('files')
  @ApiOperation({ summary: 'Arquivos que estão no bucket agora' })
  @ApiOkResponse({ type: [BackupFileDto] })
  async arquivos(): Promise<BackupFileDto[]> {
    if (!this.storage.configurado) return [];

    const arquivos = await this.storage.listar();

    return arquivos.map((arquivo) => ({
      key: arquivo.key,
      sizeBytes: arquivo.sizeBytes,
      createdAt: arquivo.criadoEm.toISOString(),
    }));
  }

  @Get('files/download')
  @Audited({ action: 'backup.download', entityType: 'backup' })
  @ApiOperation({
    summary: 'Link temporário para baixar um backup',
    description:
      'O bucket é privado e continua privado: o link é assinado e vale uma ' +
      'hora. Tornar o objeto público para facilitar o download seria publicar ' +
      'a base inteira.',
  })
  @ApiOkResponse({ type: BackupDownloadDto })
  @ApiNotFoundResponse({ description: 'Arquivo não encontrado no bucket.' })
  async baixar(@Query('key') key: string): Promise<BackupDownloadDto> {
    const arquivos = await this.storage.listar();

    if (!arquivos.some((arquivo) => arquivo.key === key)) {
      throw new NotFoundException('Backup não encontrado.');
    }

    return {
      url: await this.storage.linkTemporario(key),
      expiresInSeconds: 3600,
    };
  }
}
