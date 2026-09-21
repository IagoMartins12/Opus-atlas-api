import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PublicTeacherSummaryDto } from './public-teacher-summary.dto';

class TeacherContactPreferencesDto {
  @ApiProperty({ enum: ['whatsapp', 'email', 'both'], example: 'whatsapp' })
  preferredMethod: 'whatsapp' | 'email' | 'both';

  @ApiProperty({ example: '24 horas' })
  responseTime: string;

  @ApiProperty({ example: true })
  acceptingStudents: boolean;

  @ApiProperty({ example: 50 })
  maxStudentsPerWeek: number;

  @ApiProperty({ example: 60 })
  defaultLessonDuration: number;
}

export class PublicTeacherDetailDto extends PublicTeacherSummaryDto {
  @ApiProperty({ example: 'Professora de piano com 10 anos de experiência...' })
  fullBio: string;

  @ApiPropertyOptional({ nullable: true })
  teachingPhilosophy?: string | null;

  @ApiProperty({ type: TeacherContactPreferencesDto })
  contactPreferences: TeacherContactPreferencesDto;
}
