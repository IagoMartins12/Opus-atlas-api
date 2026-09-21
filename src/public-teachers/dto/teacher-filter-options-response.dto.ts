import { ApiProperty } from '@nestjs/swagger';

class FilterCountItemDto {
  @ApiProperty({ example: 'Piano' })
  name: string;

  @ApiProperty({ example: 14 })
  count: number;
}

export class TeacherFilterOptionsResponseDto {
  @ApiProperty({ type: [FilterCountItemDto] })
  instruments: FilterCountItemDto[];

  @ApiProperty({ type: [FilterCountItemDto] })
  specialties: FilterCountItemDto[];

  @ApiProperty({ type: [FilterCountItemDto] })
  skillLevels: FilterCountItemDto[];

  @ApiProperty({ type: [FilterCountItemDto] })
  ageGroups: FilterCountItemDto[];

  @ApiProperty({ type: [FilterCountItemDto] })
  locations: FilterCountItemDto[];
}
