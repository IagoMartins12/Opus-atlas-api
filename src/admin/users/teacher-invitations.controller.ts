import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { TeacherInvitationService } from './teacher-invitation.service';

/**
 * Resposta ao convite de professor, pelos links do e-mail.
 *
 * Pública pelo mesmo motivo do convite de aluno: quem recebe pode não estar
 * logado, e o token é a credencial. Uso único.
 */
@ApiTags('invites')
@Controller('invites/teacher')
export class TeacherInvitationsController {
  constructor(private readonly service: TeacherInvitationService) {}

  @Public()
  @Post('accept/:token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Aceita o convite para ser professor',
    description: 'Ativa o perfil de professor — não o verifica.',
  })
  @ApiParam({ name: 'token' })
  @ApiOkResponse({ description: 'Convite aceito' })
  @ApiBadRequestResponse({
    description: 'Convite inválido, expirado, já usado ou desfeito pelo admin',
    type: ErrorResponseDto,
  })
  accept(@Param('token') token: string) {
    return this.service.accept(token);
  }

  @Public()
  @Post('decline/:token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Recusa o convite para ser professor' })
  @ApiParam({ name: 'token' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  decline(@Param('token') token: string) {
    return this.service.decline(token);
  }

  @Public()
  @Post('resend/:token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Pede um novo convite com o link antigo',
    description: 'Vale com link vencido. Três reenvios por hora.',
  })
  @ApiParam({ name: 'token' })
  resend(@Param('token') token: string) {
    return this.service.resend(token);
  }
}
