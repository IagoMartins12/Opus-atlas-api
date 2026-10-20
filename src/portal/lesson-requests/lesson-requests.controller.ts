import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
  AcceptLessonRequestDto,
  CreateLessonRequestDto,
  DeclineLessonRequestDto,
  ListLessonRequestsQueryDto,
} from './dto/lesson-request.dto';
import { LessonRequestsService } from './lesson-requests.service';

@ApiTags('portal-lesson-requests')
@ApiBearerAuth('access-token')
@Controller('lesson-requests')
export class LessonRequestsController {
  constructor(private readonly service: LessonRequestsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Aluno pede uma aula num horário livre',
    description:
      'Respeita o esquema do professor: aceita pedidos, antecedência, horizonte e horário livre para os dois.',
  })
  @ApiCreatedResponse({ description: 'O pedido, pendente' })
  @ApiConflictResponse({
    description: 'Horário ocupado, com sugestões',
    type: ErrorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Fora da antecedência ou do horizonte',
    type: ErrorResponseDto,
  })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateLessonRequestDto,
  ) {
    return this.service.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Pedidos de aula (do professor ou do aluno)' })
  @ApiOkResponse({ description: 'Pendentes primeiro' })
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListLessonRequestsQueryDto,
  ) {
    return this.service.list(user.sub, query);
  }

  @Patch(':id/accept')
  @ApiOperation({
    summary: 'Professor aceita: a aula é marcada pelas regras de sempre',
  })
  @ApiOkResponse({ description: 'Pedido aceito e a aula criada' })
  @ApiConflictResponse({
    description: 'O horário deixou de estar livre',
    type: ErrorResponseDto,
  })
  accept(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AcceptLessonRequestDto,
  ) {
    return this.service.accept(user.sub, id, dto);
  }

  @Patch(':id/decline')
  @ApiOperation({ summary: 'Professor recusa, com recado opcional' })
  @ApiOkResponse({ description: 'Pedido recusado' })
  decline(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: DeclineLessonRequestDto,
  ) {
    return this.service.decline(user.sub, id, dto);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Aluno desiste do pedido' })
  @ApiNoContentResponse()
  cancel(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.service.cancel(user.sub, id);
  }
}
