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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
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
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { policyFor } from '../../common/storage/asset-policies';
import { CategoriesAdminService } from './categories-admin.service';
import {
  CreateCategoryDto,
  ReorderCategoriesDto,
  UpdateCategoryDto,
} from './dto/write-category.dto';

const IMAGE_MAX_BYTES = policyFor('BLOG_MEDIA').maxBytes;

/**
 * Painel de categorias do blog.
 *
 * Mesmo caminho do legado (`/blog/admin/categories`), que é o que o painel
 * chama. Três mudanças de contrato:
 *
 * - criação em `POST /` (era `POST /create`);
 * - edição só por `PATCH /:id` (o legado tinha `PUT` para o formulário e
 *   `PATCH` para ligar e desligar — a mesma rota parcial serve aos dois);
 * - imagem em `POST /:id/image` e `DELETE /:id/image`, ligada à categoria. A
 *   rota do legado recebia o arquivo antes de a categoria existir e apagava
 *   por um caminho vindo da query string.
 */
@ApiTags('blog-categories')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('blog/admin/categories')
export class CategoriesAdminController {
  constructor(private readonly categories: CategoriesAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'Todas as categorias, com o número real de artigos',
    description:
      'Inclui inativas, e a contagem inclui rascunhos — é ela que decide se a ' +
      'categoria pode ser apagada.',
  })
  @ApiOkResponse({ description: 'Categorias na ordem de exibição' })
  list() {
    return this.categories.list();
  }

  @Post()
  @Audited({ action: 'blog.category.create', entityType: 'blog-category' })
  @ApiOperation({
    summary: 'Cria uma categoria',
    description: 'Entra no fim da ordem. Sem slug, ele sai do nome.',
  })
  @ApiOkResponse({ description: 'Categoria criada' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Slug já usado', type: ErrorResponseDto })
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @Audited({ action: 'blog.category.reorder', entityType: 'blog-category' })
  @ApiOperation({ summary: 'Reordena as categorias, numa transação' })
  @ApiOkResponse({ description: 'Ordem gravada' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  reorder(@Body() dto: ReorderCategoriesDto) {
    return this.categories.reorder(dto.categories);
  }

  @Patch(':id')
  @Audited({
    action: 'blog.category.update',
    entityType: 'blog-category',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Edita uma categoria',
    description:
      'Parcial: serve ao formulário e ao liga/desliga. Recusa mãe inexistente ' +
      'e ciclo na hierarquia. O legado repassava o corpo inteiro ao Prisma.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Categoria atualizada' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(':id')
  @Audited({
    action: 'blog.category.delete',
    entityType: 'blog-category',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Apaga uma categoria vazia',
    description: 'Recusa se tiver subcategorias ou artigos.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Categoria apagada' })
  @ApiBadRequestResponse({
    description: 'Tem subcategorias ou artigos',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(@Param('id') id: string) {
    return this.categories.remove(id);
  }

  @Post(':id/image')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: IMAGE_MAX_BYTES, files: 1 },
    }),
  )
  @Audited({
    action: 'blog.category.image',
    entityType: 'blog-category',
    entityIdParam: 'id',
  })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Envia a imagem da categoria',
    description:
      'O tipo é conferido pelos bytes do arquivo, não pela extensão. A imagem ' +
      'anterior enviada por aqui é apagada.',
  })
  @ApiParam({ name: 'id' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ description: 'Imagem gravada; devolve a URL' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiUnsupportedMediaTypeResponse({ type: ErrorResponseDto })
  @ApiPayloadTooLargeResponse({ type: ErrorResponseDto })
  uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }

    return this.categories.uploadImage(
      id,
      { buffer: file.buffer, originalName: file.originalname, size: file.size },
      user.sub,
    );
  }

  @Delete(':id/image')
  @Audited({
    action: 'blog.category.image.remove',
    entityType: 'blog-category',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Tira a imagem da categoria',
    description:
      'Apaga o arquivo quando ele foi enviado por esta API. Imagens gravadas ' +
      'pelo legado ficam no disco do Next: são desvinculadas, não apagadas.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Imagem removida' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  removeImage(@Param('id') id: string) {
    return this.categories.removeImage(id);
  }
}
