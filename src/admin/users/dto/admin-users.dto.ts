import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DifficultyLevel, PlanType, UserType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { queryBoolean } from '../../../common/utils/query-boolean';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
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

export const USER_ACTIVITY = ['7d', '30d', 'inactive90', 'never'] as const;

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

  @ApiPropertyOptional({ description: 'E-mail confirmado (true) ou não.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  emailVerified?: boolean;

  @ApiPropertyOptional({ description: 'Cadastro inicial concluído ou não.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  onboardingCompleted?: boolean;

  @ApiPropertyOptional({ description: 'Perfil público ou privado.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  profilePublic?: boolean;

  @ApiPropertyOptional({
    enum: PlanType,
    description:
      'Plano com acesso hoje (assinatura viva). FREE: quem não tem nenhuma.',
  })
  @IsOptional()
  @IsEnum(PlanType)
  plan?: PlanType;

  @ApiPropertyOptional({
    enum: USER_ACTIVITY,
    description:
      'Último acesso: nos últimos 7 ou 30 dias, sem acesso há 90 dias, ou nunca.',
  })
  @IsOptional()
  @IsIn(USER_ACTIVITY)
  activity?: (typeof USER_ACTIVITY)[number];

  @ApiPropertyOptional({ description: 'Conta criada a partir de (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Conta criada até (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  createdTo?: string;

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
/** Planos que a equipe pode conceder junto com o convite de professor. */
export const TEACHER_GRANT_PLANS = ['MENTOR', 'MAESTRO'] as const;

/**
 * O plano que acompanha o convite para ser professor. Concedido quando a
 * pessoa **aceita** o convite — recusado, nada é concedido.
 */
export class TeacherPlanGrantDto {
  @ApiProperty({ enum: TEACHER_GRANT_PLANS })
  @IsIn(TEACHER_GRANT_PLANS)
  planType: (typeof TEACHER_GRANT_PLANS)[number];

  @ApiPropertyOptional({
    description: 'Vencimento (ISO 8601). Ausente ou nulo: sem vencimento.',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}

export class UpdateAdminUserDto {
  @ApiPropertyOptional({
    enum: USER_ROLE_LEVELS,
    description:
      '0 pessoa, 1 professor do legado (não abre o painel), 2 administrador. Ver `common/auth/roles.ts`.',
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
      'Marca a conta como de professor e envia o convite por e-mail (o ' +
      'perfil fica pendente até o aceite). Independe de `role`: 1 é admin.',
  })
  @IsOptional()
  @IsBoolean()
  isTeacher?: boolean;

  @ApiPropertyOptional({
    type: TeacherPlanGrantDto,
    description:
      'Só com `isTeacher: true`: plano concedido quando o convite for aceito.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TeacherPlanGrantDto)
  teacherPlanGrant?: TeacherPlanGrantDto;

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

/** O que a conta guardou ou fez, para abrir a lista a partir do detalhe. */
export const USER_ITEM_KINDS = [
  'favoritos',
  'aprendidas',
  'quero-aprender',
  'anotacoes',
  'envios',
  'arquivos',
] as const;

export type UserItemKind = (typeof USER_ITEM_KINDS)[number];

export class AdminUserItemsQueryDto {
  @ApiProperty({ enum: USER_ITEM_KINDS })
  @IsIn(USER_ITEM_KINDS)
  kind: UserItemKind;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
