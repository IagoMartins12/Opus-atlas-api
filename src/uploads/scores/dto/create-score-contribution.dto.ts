import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IMSLPScoreType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Envio de partitura pela comunidade.
 *
 * O arquivo em si **não** vem aqui. Ele sobe antes por `POST /uploads/file`
 * com `kind=SCORE_FILE`, e o que chega neste endpoint é o `assetId` devolvido
 * por aquela chamada.
 *
 * Essa separação eliminou todo o fluxo de arquivo temporário do legado, que
 * gravava o PDF em `/temp/`, criava o registro e depois tentava mover o arquivo
 * para o destino final — um caminho com três pontos de falha parcial, onde uma
 * queda no meio deixava registro sem arquivo ou arquivo sem registro.
 */
export class CreateScoreContributionDto {
  @ApiProperty({
    example: '685d591c1e3db0c5aaa893e4',
    description: 'Obra à qual a partitura pertence.',
  })
  @IsMongoId()
  workId: string;

  @ApiProperty({ example: 'Edição Urtext — Henle' })
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  title: string;

  @ApiPropertyOptional({
    example: '6700a1b2c3d4e5f60718293a',
    description:
      'Id devolvido por POST /uploads/file com kind=SCORE_FILE. ' +
      'Obrigatório sem `externalUrl`.',
  })
  @ValidateIf((dto: CreateScoreContributionDto) => !dto.externalUrl)
  @IsMongoId()
  assetId?: string;

  @ApiPropertyOptional({
    example: 'https://imslp.org/wiki/Special:ImagefromIndex/12345',
    description:
      'Link externo (https) da partitura, no lugar do arquivo. A API não ' +
      'busca o endereço — só o guarda para o download, como no legado.',
  })
  @ValidateIf((dto: CreateScoreContributionDto) => !dto.assetId)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  externalUrl?: string;

  @ApiPropertyOptional({
    description: 'Id da miniatura, também vindo de POST /uploads/file.',
  })
  @IsOptional()
  @IsMongoId()
  thumbnailAssetId?: string;

  @ApiPropertyOptional({ enum: IMSLPScoreType, default: IMSLPScoreType.SCORES })
  @IsOptional()
  @IsEnum(IMSLPScoreType)
  type?: IMSLPScoreType;

  @ApiPropertyOptional({ example: 'Henle' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  publisher?: string;

  @ApiPropertyOptional({ example: 'Bertha Antonia Wallner' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  editor?: string;

  @ApiPropertyOptional({ example: 'Domínio público' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  copyright?: string;

  @ApiPropertyOptional({ example: '24' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  pageCount?: string;

  @ApiPropertyOptional({ example: 'PDF', default: 'PDF' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  fileFormat?: string;

  @ApiPropertyOptional({ description: 'Observações do contribuidor.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Ordem dentro de um grupo de partituras.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  groupIndex?: number;

  @ApiPropertyOptional({ example: 'Movimentos separados' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupTitle?: string;
}
