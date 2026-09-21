import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UploadFormDataDto } from './dto/upload-form-data.dto';
import { UploadFormData, UploadSupportService } from './upload-support.service';

@ApiTags('uploads-support')
@ApiBearerAuth('access-token')
@Controller('uploads')
export class UploadSupportController {
  constructor(private readonly service: UploadSupportService) {}

  @Get('form-data')
  @ApiOperation({
    summary: 'Listas de apoio aos formulários de contribuição',
    description:
      'Épocas, instrumentos e papéis num único endpoint. Substitui as três rotas ' +
      'do legado (`form-data`, `filter-data`, `available-epochs`), que devolviam ' +
      'recortes sobrepostos das mesmas tabelas.',
  })
  @ApiOkResponse({ description: 'Listas de apoio', type: UploadFormDataDto })
  async formData(): Promise<UploadFormData> {
    return this.service.formData();
  }
}
