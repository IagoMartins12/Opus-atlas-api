import { ApiProperty } from '@nestjs/swagger';
import { PublicTeacherSummaryDto } from './public-teacher-summary.dto';

class PublicTeachersStatsDto {
  @ApiProperty({ example: 48 })
  totalTeachers: number;

  @ApiProperty({ example: 30 })
  verifiedTeachers: number;

  @ApiProperty({ example: 4.6 })
  averageRating: number;

  @ApiProperty({ example: 512 })
  totalActiveStudents: number;
}

class PublicTeachersPaginationDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 12 })
  limit: number;

  @ApiProperty({ example: 48 })
  total: number;

  @ApiProperty({ example: true })
  hasMore: boolean;
}

export class PublicTeachersListResponseDto {
  @ApiProperty({ type: [PublicTeacherSummaryDto] })
  teachers: PublicTeacherSummaryDto[];

  @ApiProperty({ type: PublicTeachersStatsDto })
  stats: PublicTeachersStatsDto;

  @ApiProperty({ type: PublicTeachersPaginationDto })
  pagination: PublicTeachersPaginationDto;
}
