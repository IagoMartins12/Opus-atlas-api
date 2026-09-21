import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AdPlacement, AdTargetType, AdUserLevel } from '@prisma/client';

export class PublicAdsQueryDto {
  @ApiPropertyOptional({ enum: AdPlacement })
  @IsOptional()
  @IsEnum(AdPlacement)
  placement?: AdPlacement;

  @ApiPropertyOptional({ enum: AdTargetType, default: AdTargetType.GENERAL })
  @IsOptional()
  @IsEnum(AdTargetType)
  targetType?: AdTargetType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  instrumentId?: string;

  @ApiPropertyOptional({ enum: AdUserLevel, default: AdUserLevel.ALL })
  @IsOptional()
  @IsEnum(AdUserLevel)
  userLevel?: AdUserLevel;
}

export const AD_EVENTS = ['impression', 'click', 'hover'] as const;

class AdEventDataDto {
  @ApiPropertyOptional({ description: 'Tempo de hover, em milissegundos' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(3_600_000)
  duration?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  pageTitle?: string;
}

export class AdEventDto {
  @ApiProperty()
  @IsString()
  adId: string;

  @ApiProperty({ enum: AD_EVENTS })
  @IsIn(AD_EVENTS)
  event: (typeof AD_EVENTS)[number];

  @ApiPropertyOptional({ type: AdEventDataDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AdEventDataDto)
  data?: AdEventDataDto;
}
