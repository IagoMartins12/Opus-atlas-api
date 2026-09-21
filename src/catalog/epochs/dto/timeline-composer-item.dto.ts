import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EpochComposerItemDto } from './epoch-composer-item.dto';

export class TimelineComposerItemDto extends EpochComposerItemDto {
  @ApiProperty({ example: 'Romântico' })
  epochName: string;

  @ApiPropertyOptional({ example: 1770, nullable: true })
  birthYear?: number | null;

  @ApiPropertyOptional({ example: 1827, nullable: true })
  deathYear?: number | null;
}
