import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AdPlacement,
  AdStatus,
  AdTargetType,
  AdType,
  AdUserLevel,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const AD_LINK_TYPES = ['url', 'whatsapp'] as const;

export type AdLinkType = (typeof AD_LINK_TYPES)[number];

export class ListAdsQueryDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: AdStatus })
  @IsOptional()
  @IsEnum(AdStatus)
  status?: AdStatus;

  @ApiPropertyOptional({ enum: AdType })
  @IsOptional()
  @IsEnum(AdType)
  type?: AdType;

  @ApiPropertyOptional({ enum: AdPlacement })
  @IsOptional()
  @IsEnum(AdPlacement)
  placement?: AdPlacement;

  @ApiPropertyOptional({ enum: AdTargetType })
  @IsOptional()
  @IsEnum(AdTargetType)
  targetType?: AdTargetType;
}

/**
 * Campos comuns a criação e edição.
 *
 * Tudo com domínio validado. No legado, `status`, `type`, `placement`,
 * `targetType` e `targetUserLevel` vinham crus do corpo: um valor fora do enum
 * só falhava no Prisma, virando 500 em vez de 400.
 */
class AdContentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Conteúdo adicional. É exibido ao usuário final — envie texto, não marcação.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  ctaText?: string;

  @ApiPropertyOptional({ enum: AD_LINK_TYPES, default: 'url' })
  @IsOptional()
  @IsIn(AD_LINK_TYPES)
  linkType?: AdLinkType;

  /**
   * Destino do anúncio.
   *
   * Validado como URL `http`/`https` quando `linkType` é `url`. O legado
   * aceitava qualquer texto — inclusive um `javascript:` — num campo que vira
   * o `href` de um link mostrado a todos os visitantes.
   */
  @ApiPropertyOptional({ example: 'https://exemplo.com/promo' })
  @IsOptional()
  @ValidateIf((dto: AdContentDto) => (dto.linkType ?? 'url') === 'url')
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  targetUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isExternal?: boolean;

  @ApiPropertyOptional({ enum: AdType, default: AdType.BANNER })
  @IsOptional()
  @IsEnum(AdType)
  type?: AdType;

  @ApiPropertyOptional({
    enum: AdPlacement,
    default: AdPlacement.SIDEBAR_RIGHT,
  })
  @IsOptional()
  @IsEnum(AdPlacement)
  placement?: AdPlacement;

  @ApiPropertyOptional({ enum: AdStatus, default: AdStatus.DRAFT })
  @IsOptional()
  @IsEnum(AdStatus)
  status?: AdStatus;

  @ApiPropertyOptional({ enum: AdTargetType, default: AdTargetType.GENERAL })
  @IsOptional()
  @IsEnum(AdTargetType)
  targetType?: AdTargetType;

  @ApiPropertyOptional({ enum: AdUserLevel, default: AdUserLevel.ALL })
  @IsOptional()
  @IsEnum(AdUserLevel)
  targetUserLevel?: AdUserLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  instrumentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  advertiserEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  advertiserPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(300)
  advertiserWebsite?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showOnMobile?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showOnTablet?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  showOnDesktop?: boolean;
}

export class CreateAdDto extends AdContentDto {
  @ApiProperty({ example: 'Curso de piano — turma de março' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Escola Harmonia' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  advertiserName: string;
}

export class UpdateAdDto extends AdContentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  advertiserName?: string;
}

export class CloneAdDto {
  @ApiPropertyOptional({
    description: 'Título do clone. Sem valor, usa "<original> — Cópia".',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ enum: AdPlacement })
  @IsOptional()
  @IsEnum(AdPlacement)
  placement?: AdPlacement;

  @ApiPropertyOptional({ enum: AdType })
  @IsOptional()
  @IsEnum(AdType)
  type?: AdType;

  @ApiPropertyOptional({ enum: AdTargetType })
  @IsOptional()
  @IsEnum(AdTargetType)
  targetType?: AdTargetType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  instrumentId?: string;
}

/** Combinação a testar contra a restrição de unicidade. */
export class CheckAdConflictQueryDto {
  @ApiProperty({ enum: AdType })
  @IsEnum(AdType)
  type: AdType;

  @ApiProperty({ enum: AdPlacement })
  @IsEnum(AdPlacement)
  placement: AdPlacement;

  @ApiProperty({ enum: AdTargetType })
  @IsEnum(AdTargetType)
  targetType: AdTargetType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  instrumentId?: string;

  @ApiPropertyOptional({ description: 'Ignora este anúncio na checagem.' })
  @IsOptional()
  @IsMongoId()
  excludeAdId?: string;
}

/** Anexa uma mídia já enviada pelo módulo de uploads. */
export class AttachAdMediaDto {
  @ApiProperty({ example: '6700a1b2c3d4e5f60718293a' })
  @IsMongoId()
  assetId: string;

  @ApiPropertyOptional({ enum: ['image', 'video'], default: 'image' })
  @IsOptional()
  @IsIn(['image', 'video'])
  kind?: 'image' | 'video';
}
