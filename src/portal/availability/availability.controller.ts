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
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { AvailabilityService } from './availability.service';
import {
  CreateAvailabilityBlockDto,
  FreeSlotsQueryDto,
  ReplaceAvailabilityDto,
} from './dto/availability.dto';

/**
 * Agenda de disponibilidade do professor.
 *
 * Não existia no legado: as "horas livres" do calendário vinham de uma
 * disponibilidade inventada. Aqui o professor declara a semana e os períodos em
 * que não atende; as horas livres saem disso menos as aulas marcadas.
 */
@ApiTags('portal-availability')
@ApiBearerAuth('access-token')
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly service: AvailabilityService) {}

  @Get()
  @ApiOperation({ summary: 'Minha agenda semanal e bloqueios futuros' })
  @ApiOkResponse({ description: 'Fuso, janelas semanais e bloqueios' })
  @ApiForbiddenResponse({
    description: 'Sem perfil de professor',
    type: ErrorResponseDto,
  })
  getMine(@CurrentUser() user: AccessTokenPayload) {
    return this.service.getMine(user.sub);
  }

  @Put()
  @ApiOperation({
    summary: 'Substituir a agenda semanal',
    description:
      'Recebe a semana inteira. Janelas do mesmo dia não podem se sobrepor, e ' +
      'nenhuma cruza a meia-noite. Lista vazia apaga a agenda.',
  })
  @ApiOkResponse({ description: 'A agenda como ficou' })
  @ApiBadRequestResponse({
    description: 'Janela inválida, sobreposta, ou fuso desconhecido',
    type: ErrorResponseDto,
  })
  replaceWeekly(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ReplaceAvailabilityDto,
  ) {
    return this.service.replaceWeekly(user.sub, dto);
  }

  @Post('blocks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bloquear um período (férias, feriado, viagem)' })
  @ApiBadRequestResponse({
    description: 'Período invertido ou maior que um ano',
    type: ErrorResponseDto,
  })
  addBlock(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateAvailabilityBlockDto,
  ) {
    return this.service.addBlock(user.sub, dto);
  }

  @Delete('blocks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desfazer um bloqueio' })
  @ApiNoContentResponse({ description: 'Bloqueio removido' })
  @ApiNotFoundResponse({
    description: 'Bloqueio inexistente ou de outro professor',
    type: ErrorResponseDto,
  })
  async removeBlock(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.removeBlock(user.sub, id);
  }

  @Get('teachers/:teacherUserId/free-slots')
  @ApiOperation({
    summary: 'Horários livres de um professor',
    description:
      'Para o próprio professor e para os alunos com vínculo aceito e ativo. ' +
      'Agenda menos bloqueios menos aulas marcadas, a partir de agora. Sem ' +
      'agenda declarada, `freeHours` é `null`.',
  })
  @ApiOkResponse({ description: 'Horários livres e total em horas' })
  @ApiForbiddenResponse({
    description: 'Nem o professor nem aluno dele',
    type: ErrorResponseDto,
  })
  freeSlots(
    @CurrentUser() user: AccessTokenPayload,
    @Param('teacherUserId') teacherUserId: string,
    @Query() query: FreeSlotsQueryDto,
  ) {
    return this.service.freeSlotsOf(user.sub, teacherUserId, query);
  }
}
