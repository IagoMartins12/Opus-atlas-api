import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AuthorsService } from './authors.service';
import { AuthorProfileResponseDto } from './dto/author-profile.dto';

/**
 * Autores do blog. Os artigos de um autor vêm da lista pública de artigos
 * (`GET /blog/articles?authorId=`): aqui mora só o perfil.
 */
@ApiTags('blog-articles')
@Public()
@Controller('blog/authors')
export class AuthorsController {
  constructor(private readonly authorsService: AuthorsService) {}

  @Get(':username')
  @ApiOperation({
    summary: 'Perfil público de quem escreve no blog',
    description:
      'Aceita o nome de usuário ou o id. Só existe para quem tem ao menos um artigo publicado: ' +
      'qualquer outra conta responde 404, para a rota não expor contas da plataforma. ' +
      'Traz o nome, a foto e a bio (os mesmos que aparecem nos artigos), o número de artigos ' +
      'publicados, as visitas somadas e as categorias em que o autor escreve. ' +
      'Cacheado por 5 minutos e invalidado junto com os artigos.',
  })
  @ApiParam({
    name: 'username',
    description: 'Nome de usuário ou id do autor',
    example: 'helena-prado',
  })
  @ApiOkResponse({ type: AuthorProfileResponseDto })
  @ApiNotFoundResponse({
    description: 'Conta inexistente ou sem artigo publicado',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit excedido',
    type: ErrorResponseDto,
  })
  findOne(@Param('username') username: string) {
    return this.authorsService.findOne(username);
  }
}
