import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContributionKind } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const CONTRIBUTION_STATUSES = ['live', 'reverted'] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class ListAdminContributionsQueryDto {
  @ApiPropertyOptional({
    enum: CONTRIBUTION_STATUSES,
    default: 'live',
    description:
      '`live`: em vigor (nascem aprovadas). `reverted`: reprovadas ou desfeitas.',
  })
  @IsOptional()
  @IsIn(CONTRIBUTION_STATUSES)
  status?: ContributionStatus;

  @ApiPropertyOptional({ enum: ContributionKind })
  @IsOptional()
  @IsEnum(ContributionKind)
  kind?: ContributionKind;

  @ApiPropertyOptional({
    description: 'Nome, sobrenome ou usuário de quem contribuiu',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class RejectContributionDto {
  @ApiProperty({
    description: 'O motivo, que vai para o autor na notificação.',
    minLength: 5,
    maxLength: 500,
  })
  @Transform(trimmed)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
