import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { EMAIL_SAMPLES, renderSample } from '../../mail/templates/samples';

enum PreviewLanguage {
  pt = 'pt',
  en = 'en',
}

/**
 * The platform's emails as they go out, with made-up data, for the team to
 * review in the panel. Read-only: nothing is sent from here.
 */
@ApiTags('admin-mail')
@ApiBearerAuth('access-token')
@Roles('SUPER_ADMIN')
@Controller('admin/mail/samples')
export class AdminMailController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os e-mails da plataforma, por grupo' })
  list() {
    return EMAIL_SAMPLES.map(({ id, group, name }) => ({ id, group, name }));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Um e-mail pronto (assunto, HTML e texto), com dados de exemplo',
  })
  @ApiQuery({ name: 'language', enum: PreviewLanguage, required: false })
  render(
    @Param('id') id: string,
    @Query('language', new ParseEnumPipe(PreviewLanguage, { optional: true }))
    language: PreviewLanguage = PreviewLanguage.pt,
  ) {
    const sample = EMAIL_SAMPLES.find((s) => s.id === id);
    if (!sample) throw new NotFoundException('E-mail não encontrado');
    const site = (
      this.config.get<string>('mail.assetsBaseUrl') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    return renderSample(sample, language, site);
  }
}
