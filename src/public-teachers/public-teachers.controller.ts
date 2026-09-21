import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/api-key.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ListTeachersQueryDto } from './dto/list-teachers-query.dto';
import { PublicTeacherDetailDto } from './dto/public-teacher-detail.dto';
import { PublicTeachersListResponseDto } from './dto/public-teachers-list-response.dto';
import { TeacherFilterOptionsResponseDto } from './dto/teacher-filter-options-response.dto';
import { PublicTeachersService } from './public-teachers.service';

@ApiTags('public-teachers')
@Controller('teachers')
export class PublicTeachersController {
  constructor(private readonly publicTeachersService: PublicTeachersService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Lista pública de professores com filtros e paginação',
    description:
      'Diretório "Conheça nossos professores" — só professores com `isPublicProfile: true` ' +
      'e `status: ACTIVE`. Substitui `getPublicTeachers`.',
  })
  @ApiOkResponse({ type: PublicTeachersListResponseDto })
  async findAll(
    @Query() query: ListTeachersQueryDto,
  ): Promise<PublicTeachersListResponseDto> {
    return this.publicTeachersService.findAll(query);
  }

  @Public()
  @Get('filter-options')
  @ApiOperation({
    summary: 'Contadores de filtros do diretório de professores',
    description:
      'Instrumentos, especialidades, níveis, faixas etárias e localizações disponíveis, ' +
      'com contagem — endpoint próprio para cache independente da listagem.',
  })
  @ApiOkResponse({ type: TeacherFilterOptionsResponseDto })
  async getFilterOptions(): Promise<TeacherFilterOptionsResponseDto> {
    return this.publicTeachersService.getFilterOptions();
  }

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Detalhe público de um professor',
    description:
      '`id` é o ID do usuário professor (não o ID do registro `Teacher`). Substitui ' +
      '`getPublicTeacherDetails`.',
  })
  @ApiOkResponse({ type: PublicTeacherDetailDto })
  @ApiNotFoundResponse({
    description: 'Professor não encontrado ou sem perfil público',
    type: ErrorResponseDto,
  })
  async findOne(@Param('id') id: string): Promise<PublicTeacherDetailDto> {
    return this.publicTeachersService.findOne(id);
  }
}
