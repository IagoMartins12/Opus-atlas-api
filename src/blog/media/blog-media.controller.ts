import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Audited } from '../../common/audit/audit.decorator';
import { Public } from '../../common/decorators/api-key.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { policyFor } from '../../common/storage/asset-policies';
import { BlogMediaService } from './blog-media.service';
import {
  CreateMediaDto,
  ListArticleMediaQueryDto,
  MEDIA_FOLDERS,
  RemoveUploadQueryDto,
  UpdateMediaDto,
  UploadMediaDto,
} from './dto/media.dto';

const UPLOAD_MAX_BYTES = Math.max(
  policyFor('BLOG_MEDIA').maxBytes,
  policyFor('BLOG_AUDIO').maxBytes,
);

/**
 * Mídia do blog.
 *
 * Mesmos caminhos do legado. A edição de mídia é `PATCH` (era `PUT`).
 *
 * As rotas `upload` são declaradas antes de `:id`: o Express casa na ordem de
 * registro, e `DELETE /blog/media/upload` não pode cair em `DELETE :id`.
 */
@ApiTags('blog-media')
@Controller('blog/media')
export class BlogMediaController {
  constructor(private readonly media: BlogMediaService) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
    }),
  )
  @Audited({ action: 'blog.media.upload', entityType: 'blog-media' })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Envia um arquivo do editor',
    description:
      'Imagem, ou áudio com `folder: audio`. Tipo conferido pelos bytes. Com ' +
      '`articleId`, o arquivo é do artigo; sem, é da sessão do formulário e o ' +
      'artigo o adota ao ser salvo. `folder` é lista fechada: ' +
      MEDIA_FOLDERS.join(', ') +
      '.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        folder: { type: 'string', enum: [...MEDIA_FOLDERS] },
        articleId: { type: 'string' },
        sessionId: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ description: 'Endereço do arquivo' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnsupportedMediaTypeResponse({ type: ErrorResponseDto })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto })
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadMediaDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo é obrigatório');
    }

    return this.media.upload({
      file: {
        buffer: file.buffer,
        originalName: file.originalname,
        size: file.size,
      },
      folder: dto.folder,
      articleId: dto.articleId,
      sessionId: dto.sessionId,
      userId: user.sub,
    });
  }

  @Delete('upload')
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Audited({ action: 'blog.media.upload.remove', entityType: 'blog-media' })
  @ApiOperation({
    summary: 'Apaga um arquivo enviado, pelo endereço',
    description:
      'Só arquivo registrado, e só se nenhum artigo ou categoria o usa — em ' +
      'uso, a resposta diz que ficou (`deleted: false`), sem erro. A rota do ' +
      'legado montava o caminho com `uploads` duas vezes e respondia 500 sempre.',
  })
  @ApiOkResponse({ description: '`deleted` diz se o arquivo saiu' })
  removeUpload(@Query() query: RemoveUploadQueryDto) {
    return this.media.removeUpload(query.url);
  }

  @Get('articles/:id/media')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Mídia da galeria de um artigo',
    description:
      'Artigo publicado, ou qualquer um para administrador. Sem `inGallery`, ' +
      'vem tudo — o legado, por um teste invertido, devolvia só o que não ' +
      'estava na galeria.',
  })
  @ApiParam({ name: 'id', description: 'Id do artigo' })
  @ApiOkResponse({ description: 'Mídia na ordem da galeria' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  list(
    @Param('id') articleId: string,
    @Query() query: ListArticleMediaQueryDto,
    @CurrentUser() user: AccessTokenPayload | undefined,
  ) {
    return this.media.listArticleMedia(articleId, query, user);
  }

  @Post('articles/:id/media')
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Audited({
    action: 'blog.media.create',
    entityType: 'blog-article',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Adiciona mídia à galeria do artigo',
    description: 'Endereço validado; vídeo aceita YouTube.',
  })
  @ApiParam({ name: 'id', description: 'Id do artigo' })
  @ApiOkResponse({ description: 'Mídia criada' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  create(@Param('id') articleId: string, @Body() dto: CreateMediaDto) {
    return this.media.createMedia(articleId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Audited({
    action: 'blog.media.update',
    entityType: 'blog-media',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Edita a mídia',
    description:
      'Só os campos da mídia. O legado repassava o corpo inteiro ao Prisma, ' +
      'e `articleId` no corpo mudava a mídia de artigo.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Mídia atualizada' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateMediaDto) {
    return this.media.updateMedia(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Audited({
    action: 'blog.media.delete',
    entityType: 'blog-media',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Tira a mídia do artigo',
    description: 'Apaga também o arquivo, se ninguém mais o usa.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Mídia removida' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(@Param('id') id: string) {
    return this.media.deleteMedia(id);
  }
}
