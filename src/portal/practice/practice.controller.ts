import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import {
  LogPracticeDto,
  PracticeGoalDto,
  PracticeQueryDto,
} from './dto/practice.dto';
import { PracticeService } from './practice.service';

@ApiTags('portal-practice')
@ApiBearerAuth('access-token')
@Controller('practice')
export class PracticeController {
  constructor(private readonly service: PracticeService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Registra uma sessão de prática' })
  @ApiCreatedResponse({ description: 'O registro' })
  @ApiForbiddenResponse({
    description: 'Sem perfil de aluno',
    type: ErrorResponseDto,
  })
  log(@CurrentUser() user: AccessTokenPayload, @Body() dto: LogPracticeDto) {
    return this.service.log(user.sub, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Diário de prática de um período',
    description:
      'Do próprio aluno, ou de um aluno do professor (`studentId`). Com soma por dia e por obra.',
  })
  @ApiOkResponse({ description: 'Registros, somas e a meta semanal' })
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: PracticeQueryDto,
  ) {
    return this.service.list(user.sub, query);
  }

  @Put('goal')
  @ApiOperation({ summary: 'Define a meta semanal de prática' })
  @ApiOkResponse({ description: 'A meta' })
  setGoal(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: PracticeGoalDto,
  ) {
    return this.service.setGoal(user.sub, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Apaga um registro do próprio diário' })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.service.remove(user.sub, id);
  }
}
