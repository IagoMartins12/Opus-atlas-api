import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { isAdmin } from '../../common/auth/roles';
import { Public } from '../../common/decorators/api-key.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import type { ContributableEntity } from './contribution-rules';
import { ContributionsService } from './contributions.service';
import {
  ContributionResponseDto,
  CuriosityResponseDto,
} from './dto/contribution.dto';
import {
  CreateContributionDto,
  CreateCuriosityDto,
} from './dto/create-contribution.dto';

@ApiTags('library-contributions')
@Controller()
export class ContributionsController {
  constructor(private readonly contributions: ContributionsService) {}

  @Post('contributions')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Contribui com um campo de compositor ou obra',
    description:
      'Entra no ar na hora e paga XP (até 10 contribuições com XP por dia). ' +
      'Exige e-mail confirmado. Moderado por denúncia.',
  })
  @ApiOkResponse({ type: ContributionResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  contribute(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateContributionDto,
  ): Promise<ContributionResponseDto> {
    return this.contributions.contribute(user.sub, dto);
  }

  @Public()
  @Get('contributions')
  @ApiOperation({ summary: 'Contribuições em vigor de um compositor ou obra' })
  @ApiQuery({ name: 'entityType', enum: ['composer', 'work'] })
  @ApiQuery({ name: 'entityId' })
  @ApiOkResponse({ type: [ContributionResponseDto] })
  list(
    @Query('entityType') entityType: ContributableEntity,
    @Query('entityId') entityId: string,
  ): Promise<ContributionResponseDto[]> {
    return this.contributions.listForEntity(
      entityType === 'work' ? 'work' : 'composer',
      entityId,
    );
  }

  @Post('contributions/:id/revert')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Desfaz uma contribuição e retira o XP (admin)' })
  @ApiNoContentResponse()
  async revert(@Param('id') id: string): Promise<void> {
    await this.contributions.revert(id, true);
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('composers/:composerId/curiosities')
  @ApiOperation({ summary: 'Curiosidades de um compositor num idioma' })
  @ApiQuery({ name: 'language', enum: ['pt', 'en'] })
  @ApiOkResponse({ type: [CuriosityResponseDto] })
  curiosities(
    @CurrentUser() user: AccessTokenPayload | undefined,
    @Param('composerId') composerId: string,
    @Query('language') language: string,
  ): Promise<CuriosityResponseDto[]> {
    return this.contributions.listCuriosities(
      composerId,
      language === 'en' ? 'en' : 'pt',
      user?.sub,
    );
  }

  @Post('composers/:composerId/curiosities')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Acrescenta uma curiosidade (vale XP)' })
  @ApiOkResponse({ type: CuriosityResponseDto })
  addCuriosity(
    @CurrentUser() user: AccessTokenPayload,
    @Param('composerId') composerId: string,
    @Body() dto: CreateCuriosityDto,
  ): Promise<CuriosityResponseDto> {
    return this.contributions.addCuriosity(user.sub, composerId, dto);
  }

  @Delete('curiosities/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Apaga uma curiosidade (autor ou admin)' })
  @ApiNoContentResponse()
  async removeCuriosity(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.contributions.removeCuriosity(user.sub, isAdmin(user.role), id);
  }
}
