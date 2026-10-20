import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CatalogQualityService } from './catalog-quality.service';

/** O quadro de qualidade do acervo no painel. */
@ApiTags('admin-catalog')
@ApiBearerAuth('access-token')
@Roles('ADMIN')
@Controller('admin/catalog-quality')
export class CatalogQualityController {
  constructor(private readonly service: CatalogQualityService) {}

  @Get()
  @ApiOperation({
    summary: 'Quanto do acervo está preenchido e confere',
    description:
      'Compositores (datas, nacionalidade, biografia, retrato, época de acordo com as datas) e obras (tonalidade, ano, instrumentação, mídia). Cache de 10 minutos.',
  })
  @ApiOkResponse({ description: 'As contagens e quando foram feitas' })
  async get() {
    return this.service.get();
  }
}
