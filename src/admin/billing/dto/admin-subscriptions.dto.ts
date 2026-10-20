import { ApiPropertyOptional } from '@nestjs/swagger';
import { BillingPeriod, PlanType } from '@prisma/client';
import { Type } from 'class-transformer';
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
} from 'class-validator';

export const PERIODOS_PANORAMA = [1, 7, 30, 90, 180, 365] as const;

export class SubscriptionsOverviewQueryDto {
  @ApiPropertyOptional({
    description: 'Janela, em dias, dos números "no período".',
    enum: PERIODOS_PANORAMA,
    default: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(PERIODOS_PANORAMA)
  days?: (typeof PERIODOS_PANORAMA)[number] = 30;
}

/**
 * Os recortes da lista, pelo que a pessoa quer saber — não pelo enum do
 * banco. "Ativas" junta quem paga e quem está em teste; "vão sair" são as
 * canceladas que ainda têm acesso; "não renovaram" são as expiradas de quem
 * não tem outra assinatura paga viva.
 */
export const ESTADOS_ASSINATURA = [
  'ativas',
  'teste',
  'atraso',
  'vao-sair',
  'nao-renovaram',
  'expiradas',
  'pendentes',
  'todas',
] as const;
export type EstadoAssinatura = (typeof ESTADOS_ASSINATURA)[number];

export class ListSubscriptionsQueryDto {
  @ApiPropertyOptional({ enum: ESTADOS_ASSINATURA, default: 'ativas' })
  @IsOptional()
  @IsIn(ESTADOS_ASSINATURA)
  estado?: EstadoAssinatura = 'ativas';

  @ApiPropertyOptional({ enum: PlanType })
  @IsOptional()
  @IsEnum(PlanType)
  plano?: PlanType;

  @ApiPropertyOptional({ enum: BillingPeriod })
  @IsOptional()
  @IsEnum(BillingPeriod)
  periodo?: BillingPeriod;

  @ApiPropertyOptional({ description: 'Nome ou e-mail de quem assina.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  busca?: string;

  @ApiPropertyOptional({ description: 'Id do último item recebido.' })
  @IsOptional()
  @IsMongoId()
  cursor?: string;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 25;
}
