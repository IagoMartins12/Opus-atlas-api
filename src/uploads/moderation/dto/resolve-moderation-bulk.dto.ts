import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsMongoId,
} from 'class-validator';
import { ResolveModerationDto } from './resolve-moderation.dto';

/**
 * Teto de denúncias por chamada.
 *
 * `delete` apaga conteúdo e arquivo de cada uma, então o lote é trabalho real,
 * não uma atualização de coluna. O legado aceitava `reportIds` de qualquer
 * tamanho.
 */
export const MAX_BULK_MODERATION = 100;

export class ResolveModerationBulkDto extends ResolveModerationDto {
  @ApiProperty({ type: [String], maxItems: MAX_BULK_MODERATION })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_MODERATION)
  @IsMongoId({ each: true })
  moderationIds!: string[];
}
