import { ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class ListNotificationsQueryDto {
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

  @ApiPropertyOptional({
    enum: NotificationStatus,
    description: 'Filtra por situação. Sem filtro, devolve todas.',
  })
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @ApiPropertyOptional({
    default: false,
    description:
      'Inclui notificações já expiradas. Por padrão, só as vigentes aparecem.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeExpired?: boolean = false;
}
