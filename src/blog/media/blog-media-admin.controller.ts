import { Body, Controller, Delete, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Audited } from '../../common/audit/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { BlogMediaService } from './blog-media.service';
import { DeleteGalleryDto, GalleryQueryDto } from './dto/media.dto';

/**
 * Galeria de arquivos do blog, no painel.
 *
 * No legado, `/admin/blog/media/gallery`, que varria o disco do Next. Aqui mora
 * junto do resto do painel do blog, em `/blog/admin/media`.
 */
@ApiTags('blog-media')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('blog/admin/media')
export class BlogMediaAdminController {
  constructor(private readonly media: BlogMediaService) {}

  @Get()
  @ApiOperation({
    summary: 'Todos os arquivos do blog, e onde cada um é usado',
    description:
      'Uso em capa, conteúdo, música de fundo, galeria e categoria — de todos ' +
      'os artigos, rascunhos incluídos (o legado ignorava rascunho, e apagar ' +
      'o arquivo "não usado" o quebrava). Mostra também os arquivos que o ' +
      'legado deixou no disco do Next, como `legacy-disk`.',
  })
  @ApiOkResponse({ description: 'Arquivos e estatísticas' })
  gallery(@Query() query: GalleryQueryDto) {
    return this.media.gallery(query);
  }

  @Delete()
  @Audited({ action: 'blog.media.gallery.delete', entityType: 'blog-media' })
  @ApiOperation({
    summary: 'Apaga arquivos da galeria',
    description:
      'Só arquivo registrado; em uso, só com `force`. A rota do legado ' +
      'apagava pelo caminho vindo do corpo, e `..` saía da pasta.',
  })
  @ApiOkResponse({ description: 'Removidos e recusados, um a um' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  remove(@Body() dto: DeleteGalleryDto) {
    return this.media.deleteFromGallery(dto);
  }
}
