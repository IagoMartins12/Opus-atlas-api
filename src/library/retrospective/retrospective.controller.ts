import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Public } from '../../common/decorators/api-key.decorator';
import { RetrospectiveService } from './retrospective.service';

class GenerateRetrospectiveDto {
  @IsIn(['year', 'all'])
  period!: 'year' | 'all';

  @IsOptional()
  @IsIn(['pt', 'en'])
  language?: 'pt' | 'en';
}

const lang = (l?: string) => (l === 'en' ? 'en' : 'pt');
const per = (p?: string) => (p === 'all' ? 'all' : 'year');

@ApiTags('retrospective')
@Controller()
export class RetrospectiveController {
  constructor(private readonly retro: RetrospectiveService) {}

  @ApiBearerAuth('access-token')
  @Get('learning/retrospective')
  @ApiOperation({
    summary: 'Situação da retrospectiva: plano, se já dá, o que foi gerado',
  })
  status(
    @CurrentUser() user: AccessTokenPayload,
    @Query('language') language?: string,
  ) {
    return this.retro.status(user.sub, lang(language));
  }

  @ApiBearerAuth('access-token')
  @Post('learning/retrospective')
  @ApiOperation({
    summary: 'Gera (ou refaz) a retrospectiva do ano ou de tudo (Plus)',
  })
  generate(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: GenerateRetrospectiveDto,
  ) {
    return this.retro.generate(user.sub, dto.period, lang(dto.language));
  }

  @ApiBearerAuth('access-token')
  @Get('learning/retrospective/:period')
  @ApiOperation({ summary: 'A retrospectiva já gerada' })
  mine(
    @CurrentUser() user: AccessTokenPayload,
    @Param('period') period: string,
    @Query('language') language?: string,
  ) {
    return this.retro.mine(user.sub, per(period), lang(language));
  }

  @Public()
  @Get('retrospectives/:shareId')
  @ApiOperation({
    summary: 'A retrospectiva compartilhada (cartões e primeiro nome)',
  })
  shared(@Param('shareId') shareId: string) {
    return this.retro.shared(shareId);
  }
}
