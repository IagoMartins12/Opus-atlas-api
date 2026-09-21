import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { Throttle } from '@nestjs/throttler';
import { AuthCookieService } from './auth-cookie.service';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ConfirmAccountResponseDto } from './dto/confirm-account-response.dto';
import { EmailChangeResponseDto } from './dto/email-change-response.dto';
import { EmailStatusResponseDto } from './dto/email-status-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

function extractIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookie: AuthCookieService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Cria uma nova conta com e-mail e senha',
    description:
      'Espelha o fluxo de credenciais hoje resolvido por `authOptions` (CredentialsProvider) do NextAuth, usando hash bcrypt compatível com a base existente.',
  })
  @ApiOkResponse({
    description: 'Conta criada e tokens emitidos com sucesso',
    type: AuthResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'E-mail já cadastrado ou payload inválido',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit excedido para este IP',
    type: ErrorResponseDto,
  })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    return this.authCookie.applySession(
      response,
      await this.authService.register(dto),
    );
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Autentica um usuário existente com e-mail e senha',
  })
  @ApiOkResponse({
    description: 'Login efetuado com sucesso',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'E-mail ou senha incorretos',
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit excedido para este IP',
    type: ErrorResponseDto,
  })
  // Brute force de senha é o ataque mais óbvio contra esta rota — 5 tentativas
  // por minuto por IP/usuário, como pede a seção 3.7 da SPEC.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    return this.authCookie.applySession(
      response,
      await this.authService.login(dto),
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renova o access token a partir de um refresh token válido',
  })
  @ApiOkResponse({
    description: 'Tokens renovados com sucesso',
    type: AuthResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Refresh token inválido, expirado ou usuário inexistente',
    type: ErrorResponseDto,
  })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const refreshToken = this.authCookie.extractRefreshToken(
      request,
      dto?.refreshToken,
    );

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token ausente');
    }

    return this.authCookie.applySession(
      response,
      await this.authService.refresh({ refreshToken }),
    );
  }

  // Pública: quem sai com o token de acesso vencido também precisa sair — e o
  // que se revoga é o refresh token apresentado, que só quem o tem apresenta.
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Encerra a sessão',
    description:
      'Apaga os cookies da sessão e revoga o refresh token apresentado — ele deixa de servir ' +
      'para renovar o token de acesso. Idempotente, e não exige token de acesso válido.',
  })
  @ApiNoContentResponse({ description: 'Sessão encerrada com sucesso' })
  async logout(
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = this.authCookie.extractRefreshToken(
      request,
      dto?.refreshToken,
    );

    // O cookie é limpo mesmo sem token: logout é idempotente e nunca deve
    // deixar credencial para trás no navegador.
    this.authCookie.clearSession(response);

    if (refreshToken) {
      await this.authService.logout({ refreshToken });
    }
  }

  @Public()
  @Get('check-email-status')
  @ApiOperation({
    summary: 'Verifica se um e-mail já está cadastrado/confirmado',
    description:
      'Endpoint público usado pelo front antes de mostrar o formulário de cadastro ou uma tela ' +
      'de "verifique seu e-mail". Não revela nenhum dado além de existência/confirmação.',
  })
  @ApiQuery({ name: 'email', example: 'aluno@opusatlas.com' })
  @ApiOkResponse({ type: EmailStatusResponseDto })
  @ApiBadRequestResponse({
    description: 'E-mail ausente ou em formato inválido',
    type: ErrorResponseDto,
  })
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async checkEmailStatus(
    @Query('email') email: string,
  ): Promise<EmailStatusResponseDto> {
    if (!email) {
      throw new BadRequestException('Email é obrigatório');
    }

    return this.authService.checkEmailStatus(email);
  }

  @Public()
  @Get('confirm-account/:token')
  @ApiOperation({
    summary:
      'Confirma a conta a partir do token enviado por e-mail no registro',
  })
  @ApiParam({
    name: 'token',
    description: 'Token de confirmação (válido por 24h)',
  })
  @ApiOkResponse({ type: ConfirmAccountResponseDto })
  @ApiBadRequestResponse({
    description: 'Token inválido, expirado ou já utilizado',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Usuário do token não existe mais',
    type: ErrorResponseDto,
  })
  async confirmAccount(
    @Param('token') token: string,
  ): Promise<ConfirmAccountResponseDto> {
    return this.authService.confirmAccount(token);
  }

  @Public()
  @Post('resend-confirmation')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Reenvia o link de confirmação de conta',
    description:
      'Sempre a mesma resposta, exista o e-mail ou não, confirmado ou não — não serve de ' +
      'consulta de contas. Aceita o e-mail ou o token de um link já enviado (mesmo vencido). ' +
      'Até três links por hora por conta; cada link novo invalida o anterior.',
  })
  @ApiOkResponse({
    description: 'Pedido aceito (resposta genérica)',
    type: MessageResponseDto,
  })
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resendConfirmation(
    @Body() dto: ResendConfirmationDto,
    @Req() req: Request,
  ): Promise<MessageResponseDto> {
    return this.authService.resendAccountConfirmation(dto, {
      ipAddress: extractIp(req),
      userAgent: req.headers['user-agent'] ?? 'unknown',
    });
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Solicita o envio de um link de redefinição de senha por e-mail',
    description:
      'Sempre retorna a mesma mensagem genérica de sucesso, exista ou não o e-mail informado ' +
      '— evita enumeração de contas cadastradas.',
  })
  @ApiOkResponse({
    description:
      'Solicitação aceita (resposta genérica, mesmo se o e-mail não existir)',
    type: MessageResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Limite de pedidos de reset excedido (5 por hora)',
    type: ErrorResponseDto,
  })
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<MessageResponseDto> {
    return this.authService.forgotPassword(dto, {
      ipAddress: extractIp(req),
      userAgent: req.headers['user-agent'] ?? 'unknown',
    });
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Redefine a senha a partir do token recebido por e-mail',
  })
  @ApiOkResponse({
    description: 'Senha alterada com sucesso',
    type: MessageResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Token inválido/expirado/usado, senhas não coincidem, senha fraca, senha igual à atual, ' +
      'ou conta vinculada ao Google (sem senha própria)',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Usuário do token não existe mais',
    type: ErrorResponseDto,
  })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<MessageResponseDto> {
    return this.authService.resetPassword(dto, { ipAddress: extractIp(req) });
  }

  @Public()
  @Get('confirm-email-change/:token')
  @ApiOperation({
    summary:
      'Confirma a mudança de e-mail solicitada a partir do perfil do usuário',
  })
  @ApiParam({
    name: 'token',
    description: 'Token de mudança de e-mail (válido por 48h)',
  })
  @ApiOkResponse({ type: EmailChangeResponseDto })
  @ApiBadRequestResponse({
    description: 'Token inválido, expirado ou já utilizado',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'O novo e-mail já está em uso por outra conta',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Usuário do token não existe mais',
    type: ErrorResponseDto,
  })
  async confirmEmailChange(
    @Param('token') token: string,
  ): Promise<EmailChangeResponseDto> {
    return this.authService.confirmEmailChange(token);
  }
}
