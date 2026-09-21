import { Body, Controller, Post, Req } from '@nestjs/common';
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
    });
  }
}
