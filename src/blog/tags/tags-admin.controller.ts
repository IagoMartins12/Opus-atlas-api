import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { CreateTagDto, UpdateTagDto } from './dto/write-tag.dto';
import { TagsAdminService } from './tags-admin.service';

/**
 * Painel de tags do blog.
 *
 * Mesmo caminho do legado (`/blog/admin/tags`), que é o que o painel chama. As
 * rotas de escrita que o legado também tinha em `/blog/tags` não foram
 * portadas: sem validação nenhuma, e o front não as usa para administrar — só
 * o formulário de artigo criava tag por lá, antes de salvar, e a gravação do
 * artigo já cria as tags que faltam.
 *
 * A edição é `PATCH`; o legado usava `PUT` com o mesmo corpo.
 */
@ApiTags('blog-tags')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('blog/admin/tags')
export class TagsAdminController {
  constructor(private readonly tags: TagsAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'Todas as tags, com o número real de artigos',
    description:
      'A contagem vem das relações (`_count.articles`), incluindo rascunhos — é ' +
      'ela que decide se a tag pode ser apagada.',
  })
  @ApiOkResponse({ description: 'Tags, das mais usadas para as menos' })
  list() {
    return this.tags.list();
  }

  @Post()
  @Audited({ action: 'blog.tag.create', entityType: 'blog-tag' })
  @ApiOperation({ summary: 'Cria uma tag' })
  @ApiOkResponse({ description: 'Tag criada' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'Nome ou slug já usados',
    type: ErrorResponseDto,
  })
  create(@Body() dto: CreateTagDto) {
    return this.tags.create(dto);
  }

  @Patch(':id')
  @Audited({
    action: 'blog.tag.update',
    entityType: 'blog-tag',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Edita uma tag',
    description:
      'Só nome, slug, descrição e cor. O legado repassava o corpo inteiro ao ' +
      'Prisma, o que aceitava escrita aninhada nas relações da tag.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Tag atualizada' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateTagDto) {
    return this.tags.update(id, dto);
  }

  @Delete(':id')
  @Audited({
    action: 'blog.tag.delete',
    entityType: 'blog-tag',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Apaga uma tag sem artigos',
    description: 'Tag em uso é recusada: tire-a dos artigos antes.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Tag apagada' })
  @ApiBadRequestResponse({
    description: 'A tag está em uso',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(@Param('id') id: string) {
    return this.tags.remove(id);
  }
}
