import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { SuggestWorkDto } from './dto/repertoire.dto';
import { RepertoireService } from './repertoire.service';

@ApiTags('portal-repertoire')
@ApiBearerAuth('access-token')
@Controller()
export class RepertoireController {
  constructor(private readonly service: RepertoireService) {}

  @Get('student/repertoire')
  @ApiOperation({
    summary: 'Meu repertório: estudando, quero aprender e já aprendi',
  })
  @ApiOkResponse({ description: 'As três listas' })
  mine(@CurrentUser() user: AccessTokenPayload) {
    return this.service.mine(user.sub);
  }

  @Get('teacher/students/:studentId/repertoire')
  @ApiOperation({
    summary: 'O repertório de um aluno',
    description:
      'Só do aluno do professor, e se o aluno compartilha (`allowProgressShare`).',
  })
  @ApiOkResponse({ description: 'As três listas' })
  @ApiForbiddenResponse({
    description: 'O aluno não compartilha',
    type: ErrorResponseDto,
  })
  ofStudent(
    @CurrentUser() user: AccessTokenPayload,
    @Param('studentId') studentId: string,
  ) {
    return this.service.ofStudent(user.sub, studentId);
  }

  @Post('teacher/students/:studentId/suggestions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Sugere uma obra ao aluno',
    description:
      'Entra no "quero aprender" do aluno, com o nome de quem sugeriu. O aluno é avisado.',
  })
  suggest(
    @CurrentUser() user: AccessTokenPayload,
    @Param('studentId') studentId: string,
    @Body() dto: SuggestWorkDto,
  ) {
    return this.service.suggest(user.sub, studentId, dto);
  }
}
