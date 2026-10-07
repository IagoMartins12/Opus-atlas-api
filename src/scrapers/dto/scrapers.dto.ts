import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  Min,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { SCRAPER_IDS } from '../scraper-registry';

export class SetScraperScheduleDto {
  @ApiProperty({
    example: '0 3 * * *',
    description:
      'Expressão cron de cinco campos, no fuso America/Sao_Paulo. Madrugada é ' +
      'a hora certa: é quando o site da casa tem menos gente e a rodada não ' +
      'disputa recursos com o tráfego de usuário.',
  })
  @IsString()
  @MaxLength(100)
  cron!: string;
}

export class ListImportedEventsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: SCRAPER_IDS,
    description: 'Só os eventos desta casa',
  })
  @IsOptional()
  @IsIn(SCRAPER_IDS)
  scraperId?: string;

  @ApiPropertyOptional({ enum: EventStatus })
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @ApiPropertyOptional({ description: 'Trecho do título' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({
    enum: ['futuros', 'passados'],
    description: 'Pela data do evento, não da importação',
  })
  @IsOptional()
  @IsIn(['futuros', 'passados'])
  when?: 'futuros' | 'passados';

  @ApiPropertyOptional({ description: 'Importados a partir de (ISO)' })
  @IsOptional()
  @IsDateString()
  importedFrom?: string;
}

export class ImportarDaPreviaDto {
  @ApiProperty({
    type: [Number],
    example: [0, 3, 4],
    description:
      'Posições dos eventos na prévia (`eventos[].indice`). O conteúdo de cada evento é lido da rodada guardada, não do corpo.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @IsInt({ each: true })
  @Min(0, { each: true })
  indices!: number[];
}
