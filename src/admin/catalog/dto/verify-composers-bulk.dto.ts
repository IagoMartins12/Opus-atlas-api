import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const MAX_BULK_VERIFY = 500;

export class VerifyComposersBulkDto {
  @ApiProperty({ type: [String], maxItems: MAX_BULK_VERIFY })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_VERIFY)
  @IsMongoId({ each: true })
  composerIds!: string[];

  @ApiProperty({
    description:
      'Verdadeiro marca como verificado; falso retira a verificação e limpa a ' +
      'atribuição — um registro não pode aparecer como não verificado e, ao ' +
      'mesmo tempo, "verificado por Fulano".',
  })
  @IsBoolean()
  isVerified!: boolean;

  @ApiPropertyOptional({
    description:
      'Justificativa. Gravada nos dois sentidos: a nota escrita ao **retirar** ' +
      'a verificação é justamente a que mais importa registrar.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
