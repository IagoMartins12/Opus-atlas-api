import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { StorageAssetKind } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { policyFor } from '../common/storage/asset-policies';
import { CreateSignedUploadDto } from './dto/create-signed-upload.dto';
import { SignedUploadResponseDto } from './dto/signed-upload-response.dto';
import { StoredAssetDto } from './dto/stored-asset.dto';
import { UploadsService } from './uploads.service';

/**
 * Superfície genérica de upload.
 *
 * Dois caminhos, escolhidos pela política de cada tipo de arquivo:
 *
 * - **Imagem e PDF** sobem por `POST /uploads/file`, passando pela API, que
 *   valida os bytes antes de repassar ao armazenamento.
 * - **Vídeo e áudio** usam `POST /uploads/signed` seguido de
 *   `POST /uploads/:assetId/confirm`. O arquivo vai direto do navegador para o
 *   armazenamento, sem atravessar o processo da API — um vídeo de 500MB
 *   passando por aqui consumiria memória e seguraria uma conexão por minutos.
 */
@ApiTags('uploads')
@ApiBearerAuth('access-token')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('signed')
  @HttpCode(HttpStatus.CREATED)
  // Cada assinatura reserva um destino no armazenamento; sem limite, dá para
  // encher a tabela de reservas pendentes com chamadas em sequência.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Autoriza o envio de um arquivo grande direto ao armazenamento',
    description:
      'Devolve uma assinatura válida apenas para a pasta e o nome reservados aqui. ' +
      'O navegador envia o arquivo direto ao provedor e depois chama a confirmação. ' +
      'O segredo do provedor nunca sai do servidor.',
  })
  @ApiCreatedResponse({ type: SignedUploadResponseDto })
  @ApiBadRequestResponse({
    description:
      'Tipo de arquivo deve ser enviado pela API, não por upload direto',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Limite do plano atingido ou sem permissão sobre a entidade',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  async createSignedUpload(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateSignedUploadDto,
  ): Promise<SignedUploadResponseDto> {
    return this.uploadsService.createSignedUpload(user.sub, dto);
  }

  @Post(':assetId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirma que o arquivo chegou ao armazenamento',
    description:
      'A API consulta o provedor em vez de acreditar no cliente: sem essa checagem, ' +
      'bastaria chamar este endpoint sem ter enviado nada para o banco passar a ' +
      'apontar para um arquivo inexistente. O limite de tamanho também é reconferido ' +
      'aqui, já que no envio direto o servidor não vê os bytes.',
  })
  @ApiParam({ name: 'assetId', example: '6700a1b2c3d4e5f60718293a' })
  @ApiOkResponse({ type: StoredAssetDto })
  @ApiBadRequestResponse({
    description: 'O arquivo não foi encontrado no armazenamento',
    type: ErrorResponseDto,
  })
  @ApiPayloadTooLargeResponse({
    description: 'Arquivo excede o limite do tipo (é removido do provedor)',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Upload não encontrado',
    type: ErrorResponseDto,
  })
  async confirmUpload(
    @CurrentUser() user: AccessTokenPayload,
    @Param('assetId') assetId: string,
  ): Promise<StoredAssetDto> {
    return this.uploadsService.confirmUpload(user.sub, assetId);
  }

  @Post('file')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      // Teto absoluto do multipart, acima do maior limite por tipo. O limite
      // real de cada tipo é aplicado no serviço; este só impede que uma
      // requisição gigante seja bufferizada antes de qualquer validação.
      limits: { fileSize: 30 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Envia uma imagem ou PDF através da API',
    description:
      'O tipo do arquivo é determinado pelos bytes iniciais, não pela extensão nem ' +
      'pelo cabeçalho informado no envio — os dois são controlados pelo cliente.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'kind', 'scopeId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        kind: { type: 'string', enum: Object.values(StorageAssetKind) },
        scopeId: { type: 'string', example: '685d591c1e3db0c5aaa893e4' },
      },
    },
  })
  @ApiCreatedResponse({ type: StoredAssetDto })
  @ApiUnsupportedMediaTypeResponse({
    description: 'Formato não aceito para este tipo de arquivo',
    type: ErrorResponseDto,
  })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  async uploadFile(
    @CurrentUser() user: AccessTokenPayload,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('kind') kind: string,
    @Body('scopeId') scopeId: string,
  ): Promise<StoredAssetDto> {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }

    if (!this.isAssetKind(kind)) {
      throw new BadRequestException(`Tipo de arquivo inválido: ${kind}`);
    }

    if (!scopeId || !/^[A-Za-z0-9_-]+$/.test(scopeId)) {
      throw new BadRequestException('scopeId inválido');
    }

    // Reforça o teto do tipo antes de tocar no provedor. O limite do multipart
    // é o teto absoluto; cada tipo tem o seu, menor.
    if (file.size > policyFor(kind).maxBytes) {
      throw new BadRequestException(
        `Arquivo excede o limite de ${Math.round(policyFor(kind).maxBytes / (1024 * 1024))}MB para ${kind}`,
      );
    }

    return this.uploadsService.uploadFile(user.sub, kind, scopeId, {
      buffer: file.buffer,
      originalName: file.originalname,
      size: file.size,
    });
  }

  @Delete(':assetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove um arquivo enviado pelo usuário',
    description:
      'Remove do armazenamento e marca o registro como removido. O registro não é ' +
      'apagado: ele permanece como trilha de que o arquivo existiu.',
  })
  @ApiParam({ name: 'assetId', example: '6700a1b2c3d4e5f60718293a' })
  @ApiNoContentResponse({ description: 'Arquivo removido' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'O arquivo pertence a outro usuário',
    type: ErrorResponseDto,
  })
  async deleteAsset(
    @CurrentUser() user: AccessTokenPayload,
    @Param('assetId') assetId: string,
  ): Promise<void> {
    await this.uploadsService.deleteOwnAsset(user.sub, assetId);
  }

  private isAssetKind(value: string): value is StorageAssetKind {
    return Object.values(StorageAssetKind).includes(value as StorageAssetKind);
  }
}
