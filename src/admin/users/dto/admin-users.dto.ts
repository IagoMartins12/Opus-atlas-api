import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DifficultyLevel, UserType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { queryBoolean } from '../../../common/utils/query-boolean';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Níveis de papel aceitos.
 *
 * O legado gravava `role` cru do corpo, sem conferir o valor. Como o guard
 * compara `user.role < nívelExigido`, um `role: 999` passaria por qualquer
 * verificação de permissão — e um valor negativo trancaria a conta fora de tudo.
 */
export const USER_ROLE_LEVELS = [0, 1, 2] as const;

export type UserRoleLevel = (typeof USER_ROLE_LEVELS)[number];

export const USER_SORT_FIELDS = [
  'createdAt',
  'lastSeen',
  'email',
  'firstName',
] as const;

// Da query vem texto, e a conversão implícita do ValidationPipe já teria
// transformado "false" em `true` antes do `@Transform`: lê o valor cru.
const toBoolean = queryBoolean;

export class ListAdminUsersQueryDto {
  @ApiPropertyOptional({
    description:
      'Id do último item da página anterior. Com ele, a lista continua de ' +
      'onde parou (rolagem infinita) e `page` é ignorado.',
  })
  @IsOptional()
  @IsMongoId()
  cursor?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;

  @ApiPropertyOptional({ description: 'Busca por nome, e-mail ou usuário.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: UserType })
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  @ApiPropertyOptional({ enum: DifficultyLevel })
  @IsOptional()
  @IsEnum(DifficultyLevel)
  experienceLevel?: DifficultyLevel;

  @ApiPropertyOptional({ enum: USER_ROLE_LEVELS })
  @IsOptional()
  @Type(() => Number)
  @IsIn(USER_ROLE_LEVELS)
  role?: UserRoleLevel;

  @ApiPropertyOptional({ description: 'Só quem tem perfil de professor.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isTeacher?: boolean;

  @ApiPropertyOptional({ enum: USER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(USER_SORT_FIELDS)
  sortBy?: (typeof USER_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class ExportAdminUsersQueryDto extends ListAdminUsersQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'json'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';
}

export const ANALYTICS_PERIODS = ['7d', '30d', '90d', '1y'] as const;

export class AdminUserAnalyticsQueryDto {
  @ApiPropertyOptional({ enum: ANALYTICS_PERIODS, default: '30d' })
  @IsOptional()
  @IsIn(ANALYTICS_PERIODS)
  period?: (typeof ANALYTICS_PERIODS)[number];
}

/**
 * Alteração administrativa de um usuário.
 *
 * Lista fechada e com domínio validado. O legado aceitava `role` e `userType`
 * do corpo sem conferir o valor de nenhum dos dois.
 */
export class UpdateAdminUserDto {
  @ApiPropertyOptional({
    enum: USER_ROLE_LEVELS,
    description: '0 comum, 1 admin, 2 super admin.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(USER_ROLE_LEVELS)
  role?: UserRoleLevel;

  @ApiPropertyOptional({ enum: UserType })
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  @ApiPropertyOptional({
    description:
      'Marca a conta como de professor, criando o perfil se faltar. Mudar ' +
      '`role` para 1 já faz isso.',
  })
  @IsOptional()
  @IsBoolean()
  isTeacher?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isStudent?: boolean;
}

export class AdminUserSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiPropertyOptional() name: string | null;
  @ApiProperty() role: number;
}
