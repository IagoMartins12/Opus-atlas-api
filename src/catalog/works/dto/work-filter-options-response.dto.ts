import { ApiProperty } from '@nestjs/swagger';
import {
  DifficultyLevelDto,
  PopularComposerFilterDto,
  WorkFilterOptionItemDto,
} from './work-filter-option-item.dto';

export class WorkFilterOptionsResponseDto {
  @ApiProperty({ type: [WorkFilterOptionItemDto] })
  instruments: WorkFilterOptionItemDto[];

  @ApiProperty({ type: [WorkFilterOptionItemDto] })
  epochs: WorkFilterOptionItemDto[];

  @ApiProperty({ type: [WorkFilterOptionItemDto] })
  workGenres: WorkFilterOptionItemDto[];

  @ApiProperty({ type: [PopularComposerFilterDto] })
  popularComposers: PopularComposerFilterDto[];

  @ApiProperty({ type: [DifficultyLevelDto] })
  difficultyLevels: DifficultyLevelDto[];
}
