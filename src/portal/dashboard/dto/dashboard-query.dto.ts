import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class DashboardQueryDto {
  @ApiPropertyOptional({
    enum: ['teacher', 'student'],
    description:
      'Qual painel montar. Sem valor, usa o perfil de professor se houver.',
  })
  @IsOptional()
  @IsIn(['teacher', 'student'])
  as?: 'teacher' | 'student';
}

export class PortalOnboardingDto {
  @ApiPropertyOptional({ enum: ['teacher', 'student'] })
  @IsIn(['teacher', 'student'])
  role: 'teacher' | 'student';
}
