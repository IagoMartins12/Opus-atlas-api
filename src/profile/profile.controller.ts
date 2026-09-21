import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { PersonalDataExportDto } from './export/dto/personal-data-export.dto';
import { AvatarResponseDto } from './dto/avatar-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { HeartbeatDto } from './dto/heartbeat.dto';
import {
  AccountCascadeInfoDto,
  DeleteAccountResponseDto,
  HeartbeatResponseDto,
  ProfileResponseDto,
} from './dto/profile-response.dto';
import { ProfileQueryDto } from './dto/profile-query.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { OnboardingDto, UpdateProfileDto } from './dto/update-profile.dto';
import { PersonalDataExportService } from './export/personal-data-export.service';
import { ProfileService, ProfileView } from './profile.service';

function extractIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}

/**
 * Perfil de quem chamou — conta, preferências, instrumentos e os perfis de
 * professor e de aluno.
 *
 * Uma leitura (`GET /profile`, com `include`) e uma escrita (`PATCH /profile`,
 * com blocos) para tudo o que é da pessoa. As demais rotas são operações com
 * regra própria: senha, troca de e-mail, foto, exportação, exclusão, presença.
 */
@ApiTags('profile')
@ApiBearerAuth('access-token')
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly personalDataExport: PersonalDataExportService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Perfil de quem chamou — a conta e, se pedido, o resto',
    description:
      'Sem `include`, vem tudo: conta, instrumentos, estatísticas e os perfis de professor e de ' +
      'aluno com os vínculos — estes só para quem tem o papel (`null` para quem não tem), e ' +
      'criados na primeira leitura. `?include=account` é o "quem sou eu": só a conta, com o que ' +
      'a sessão do front usa (papel, verificação de professor, convite de aluno, onboarding, ' +
      'forma de login, plano).',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  async getProfile(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ProfileQueryDto,
  ): Promise<ProfileView> {
    return this.profileService.get(user.sub, query.include);
  }

  @Patch()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Atualiza o perfil — só o que vier',
    description:
      'Blocos opcionais: `account` (nome, bio, localização, telefone, tipo de conta, preferências ' +
      'musicais, privacidade), `instruments` (substitui a lista), `teacher` e `student` (perfis do ' +
      'portal, só para quem tem o papel). Tudo numa transação; devolve a conta e os blocos ' +
      'alterados. Foto, senha e e-mail têm rotas próprias.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiBadRequestResponse({
    description:
      'Corpo vazio, campo fora do domínio ou dois instrumentos principais',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Bloco de professor ou de aluno em conta sem o papel',
    type: ErrorResponseDto,
  })
  async updateProfile(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileView> {
    return this.profileService.update(user.sub, dto);
  }

  @Post('onboarding')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Conclui o cadastro inicial',
    description:
      'Mesmo corpo do `PATCH /profile`; marca o cadastro como concluído e cria os perfis dos ' +
      'papéis da conta. Devolve o perfil completo.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiConflictResponse({
    description: 'O cadastro inicial já foi concluído',
    type: ErrorResponseDto,
  })
  async completeOnboarding(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: OnboardingDto,
  ): Promise<ProfileView> {
    return this.profileService.completeOnboarding(user.sub, dto);
  }

  @Patch('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Altera a senha (ou define a primeira, se a conta só usa login social)',
  })
  @ApiNoContentResponse({ description: 'Senha alterada com sucesso' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Senha atual incorreta',
    type: ErrorResponseDto,
  })
  async changePassword(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.profileService.changePassword(user.sub, dto);
  }

  @Post('email-change')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Solicita a troca de e-mail',
    description:
      'Envia um link de confirmação para o novo e-mail (válido por 24h). A troca só é ' +
      'efetivada em `GET /auth/confirm-email-change/:token`.',
  })
  @ApiAcceptedResponse({
    description:
      'Link de confirmação enviado ao novo e-mail; a troca só vale depois ' +
      'de ele ser aberto. Sem corpo.',
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiConflictResponse({
    description: 'E-mail já usado por outra conta',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Senha atual incorreta',
    type: ErrorResponseDto,
  })
  async requestEmailChange(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: RequestEmailChangeDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.profileService.requestEmailChange(user.sub, dto, {
      ipAddress: extractIp(req),
      userAgent: req.headers['user-agent'] ?? 'unknown',
    });
  }

  @Get('export')
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Exporta os dados pessoais da conta (LGPD, Art. 18, V)',
    description:
      'Devolve um JSON com tudo que a plataforma guarda **sobre quem pede**, ' +
      'em seções, e a lista do que ficou de fora com o motivo. Credenciais ' +
      'nunca entram: portabilidade é levar os seus dados, não as chaves da sua ' +
      'conta. Limite de três exportações por hora.',
  })
  @ApiOkResponse({
    description:
      'Documento de exportação, com `truncatedSections` avisando se alguma ' +
      'seção bateu no teto de 50 mil linhas.',
    type: PersonalDataExportDto,
  })
  async exportPersonalData(
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) response: Response,
  ) {
    const document = await this.personalDataExport.collect(user.sub);

    // Anexo, não corpo de página: o arquivo é para ser guardado por quem
    // pediu, e o nome traz a data para distinguir exportações sucessivas.
    const stamp = document.generatedAt.toISOString().slice(0, 10);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="opus-atlas-dados-${stamp}.json"`,
    );

    return document;
  }

  @Get('cascade-info')
  @ApiOperation({
    summary: 'Lista o que seria apagado ao excluir a conta',
    description:
      'Usado para confirmar a exclusão de conta com o usuário antes de executá-la.',
  })
  @ApiOkResponse({ type: AccountCascadeInfoDto })
  async getCascadeInfo(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<AccountCascadeInfoDto> {
    return this.profileService.getCascadeInfo(user.sub);
  }

  @Delete()
  @ApiOperation({
    summary: 'Exclui a conta permanentemente',
    description:
      'Exige a senha atual quando a conta tem uma (hardening novo em relação ao legado, que ' +
      'excluía sem nenhuma confirmação). Cascata via schema remove dados relacionados.',
  })
  @ApiOkResponse({ type: DeleteAccountResponseDto })
  @ApiBadRequestResponse({
    description: 'Senha atual não informada',
    type: ErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Senha atual incorreta',
    type: ErrorResponseDto,
  })
  async deleteAccount(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: DeleteAccountDto,
  ): Promise<DeleteAccountResponseDto> {
    return this.profileService.deleteAccount(user.sub, dto);
  }

  @Post('heartbeat')
  @ApiOperation({
    summary: 'Atualiza a última atividade do usuário (presença online)',
  })
  @ApiOkResponse({ type: HeartbeatResponseDto })
  async heartbeat(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: HeartbeatDto,
  ): Promise<HeartbeatResponseDto> {
    return this.profileService.heartbeat(user.sub, dto);
  }

  @Delete('avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a foto de perfil',
    description:
      'Apaga o arquivo guardado e limpa a foto. Foto vinda do Google (endereço externo) só é ' +
      'desvinculada.',
  })
  @ApiNoContentResponse({ description: 'Foto removida' })
  async removeAvatar(@CurrentUser() user: AccessTokenPayload): Promise<void> {
    await this.profileService.removeAvatar(user.sub);
  }

  @Post('avatar')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Troca a foto de perfil',
    description:
      'A imagem vai para o armazenamento em nuvem e a URL é gravada no perfil. ' +
      'O tipo é verificado pelos bytes do arquivo, não pela extensão. A foto ' +
      'anterior é removida automaticamente.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: AvatarResponseDto })
  @ApiBadRequestResponse({
    description: 'Nenhum arquivo enviado',
    type: ErrorResponseDto,
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'O arquivo não é uma imagem em formato aceito',
    type: ErrorResponseDto,
  })
  @ApiPayloadTooLargeResponse({
    description: 'Imagem acima de 5MB',
    type: ErrorResponseDto,
  })
  async updateAvatar(
    @CurrentUser() user: AccessTokenPayload,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<AvatarResponseDto> {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }

    return this.profileService.updateAvatar(user.sub, {
      buffer: file.buffer,
      originalName: file.originalname,
      size: file.size,
    });
  }
}
