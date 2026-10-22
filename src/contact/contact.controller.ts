import { localeFromHeader } from '../common/i18n/locale';
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/decorators/api-key.decorator';
import { ContactResponseDto } from './dto/contact-response.dto';
import { SubmitContactDto } from './dto/submit-contact.dto';
import { ContactService } from './contact.service';
import { Throttle } from '@nestjs/throttler';

function extractIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Public()
  // Formulário público que dispara e-mail — limite baixo contra spam.
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  // Logado ou não: com sessão, o chamado sabe de quem é (e se é prioritário).
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  @ApiOperation({
    summary: 'Envia uma mensagem de contato',
    description:
      'Gera um ticket, notifica o suporte por e-mail, envia confirmação ao remetente e, ' +
      'opcionalmente, inscreve o e-mail na newsletter.',
  })
  @ApiOkResponse({ type: ContactResponseDto })
  async submit(
    @Body() dto: SubmitContactDto,
    @Req() req: Request,
  ): Promise<ContactResponseDto> {
    return this.contactService.submit(dto, {
      ipAddress: extractIp(req),
      userAgent: req.headers['user-agent'] ?? 'unknown',
      userId: (req as Request & { user?: { sub?: string } }).user?.sub,
      // O idioma do site, e sem ele o do navegador de quem escreveu.
      language:
        dto.language ?? localeFromHeader(req.headers['accept-language']),
    });
  }
}
