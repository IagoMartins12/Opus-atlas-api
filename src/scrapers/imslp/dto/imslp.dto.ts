import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';
import { MAX_IMPORT_BATCH } from '../imslp-import.service';

export class ScrapeWorkDto {
  @ApiProperty({
    example:
      'https://imslp.org/wiki/Piano_Sonata_No.14_(Beethoven,_Ludwig_van)',
    description:
      'Endereço da obra no IMSLP. O **host** é conferido contra uma lista ' +
      'fechada, e só HTTPS é aceito — a validação do legado era um ' +
      '`includes("imslp.org")` sobre a URL inteira, o que deixava passar ' +
      'qualquer endereço que contivesse esse texto em qualquer lugar.',
  })
  @IsString()
  @MaxLength(2000)
  url!: string;
}

export class ScrapeComposerPageDto {
  @ApiProperty({
    example: 'https://imslp.org/wiki/Category:Satie,_Erik',
    description:
      'Endereço da página do compositor no IMSLP. O **host** é conferido ' +
      'contra uma lista fechada e só HTTPS é aceito.',
  })
  @IsString()
  @MaxLength(2000)
  url!: string;
}

export class ImportWorksDto {
  @ApiProperty({
    type: [String],
    maxItems: MAX_IMPORT_BATCH,
    description:
      'Endereços das obras no IMSLP, como vêm da descoberta. Cada um é lido ' +
      'e gravado; o resultado diz, obra a obra, o que aconteceu.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_IMPORT_BATCH)
  @IsString({ each: true })
  urls!: string[];
}
