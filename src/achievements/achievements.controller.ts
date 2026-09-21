import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { Public } from '../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AchievementsService } from './achievements.service';
import {
  AchievementCatalogResponseDto,
  AchievementListResponseDto,
  AchievementProgressResponseDto,
  AchievementStatsResponseDto,
  CheckAchievementsResponseDto,
} from './dto/achievement.dto';

/**
 * Conquistas do usuário.
 *
 * Não existe endpoint para *conceder* uma conquista. No legado,
 * `POST /achievements` recebia `badgeId`, `name`, `category` e `rarity` do
 * corpo da requisição e criava a conquista com o XP correspondente — qualquer
 * usuário podia conceder a si mesmo um badge lendário e 100 XP, repetidamente,
 * variando o `badgeId`. Aqui o servidor é dono do catálogo e calcula tudo a
 * partir do dado real; ao cliente resta pedir uma verificação e ler.
 */
@ApiTags('achievements')
@ApiBearerAuth('access-token')
@Controller('achievements')
export class AchievementsController {
  constructor(private readonly service: AchievementsService) {}

  @Get()
  @ApiOperation({
    summary: 'Conquistas do usuário, desbloqueadas e pendentes',
    description:
      'As pendentes vêm com o progresso atual calculado no servidor, para a tela ' +
      'mostrar o quanto falta sem precisar refazer a conta.',
  })
  @ApiOkResponse({ type: AchievementListResponseDto })
  async list(@CurrentUser() user: AccessTokenPayload) {
    return this.service.listForUser(user.sub);
  }

  @Post('check')
  @HttpCode(HttpStatus.OK)
  // A verificação lê bastante do banco. O disparo normal é automático, por
  // evento; este endpoint existe para a tela forçar uma checagem pontual.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verifica e concede as conquistas desbloqueadas',
    description:
      'Reavalia o catálogo inteiro contra os dados do usuário. O XP só é ' +
      'creditado quando a conquista é de fato criada, na mesma transação — duas ' +
      'verificações simultâneas não creditam em dobro.',
  })
  @ApiOkResponse({ type: CheckAchievementsResponseDto })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  async check(
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<CheckAchievementsResponseDto> {
    const unlocked = await this.service.evaluate(user.sub);

    return {
      unlocked,
      count: unlocked.length,
      xpGained: unlocked.reduce((sum, badge) => sum + badge.xpReward, 0),
    };
  }

  @Get('progress')
  @ApiOperation({
    summary: 'Progresso rumo às conquistas pendentes',
    description:
      'Ordenado da mais próxima de ser desbloqueada para a mais distante.',
  })
  @ApiOkResponse({ type: AchievementProgressResponseDto })
  async progress(@CurrentUser() user: AccessTokenPayload) {
    return this.service.progressForUser(user.sub);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'XP, nível e distribuição das conquistas',
    description: 'O nível avança a cada 100 XP acumulados.',
  })
  @ApiOkResponse({ type: AchievementStatsResponseDto })
  async stats(@CurrentUser() user: AccessTokenPayload) {
    return this.service.statsForUser(user.sub);
  }

  @Public()
  @Get('catalog')
  @ApiOperation({
    summary: 'Catálogo completo de conquistas',
    description:
      'Público: serve para a página de "como funciona" mostrar tudo o que dá ' +
      'para conquistar, sem exigir login. Não contém dado de usuário.',
  })
  @ApiOkResponse({ type: AchievementCatalogResponseDto })
  catalog(): AchievementCatalogResponseDto {
    return this.service.catalog();
  }

  @Post(':badgeId/viewed')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Marca a conquista como vista',
    description: 'Faz o aviso de conquista nova parar de aparecer.',
  })
  @ApiParam({ name: 'badgeId', example: 'first-goal' })
  @ApiNoContentResponse({ description: 'Conquista marcada como vista' })
  @ApiNotFoundResponse({
    description: 'Conquista inexistente ou não desbloqueada por este usuário',
    type: ErrorResponseDto,
  })
  async markAsViewed(
    @CurrentUser() user: AccessTokenPayload,
    @Param('badgeId') badgeId: string,
  ): Promise<void> {
    await this.service.markAsViewed(user.sub, badgeId);
  }
}
