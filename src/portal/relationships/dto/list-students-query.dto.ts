import { ApiPropertyOptional } from '@nestjs/swagger';
import { StudentInviteStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListStudentsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: StudentInviteStatus })
  @IsOptional()
  @IsEnum(StudentInviteStatus)
  inviteStatus?: StudentInviteStatus;

  @ApiPropertyOptional({
    default: true,
    description: 'Somente vínculos ativos. `false` inclui os encerrados.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlyActive?: boolean = true;

  @ApiPropertyOptional({ description: 'Busca por nome ou e-mail do aluno.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
