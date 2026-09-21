import { ApiProperty } from '@nestjs/swagger';
import { DifficultyLevelDto } from '../../works/dto/work-filter-option-item.dto';

class ComposerFilterInstrumentDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Piano' })
  name: string;
}

export class ComposerFilterOptionsResponseDto {
  @ApiProperty({ type: [ComposerFilterInstrumentDto] })
  instruments: ComposerFilterInstrumentDto[];

  @ApiProperty({ type: [String], example: ['Sonata', 'Concerto'] })
  workGenres: string[];

  @ApiProperty({ type: [String], example: ['Piano Solo', 'Música de Câmara'] })
  categories: string[];

  @ApiProperty({ type: [DifficultyLevelDto] })
  difficultyLevels: DifficultyLevelDto[];
}
