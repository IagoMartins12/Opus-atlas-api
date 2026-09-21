import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * As seções `teacher` e `student` de `GET /profile`.
 *
 * Elas existiam no contrato como "objeto livre" — quem gerava cliente a partir
 * do OpenAPI não recebia campo nenhum. Aqui estão os campos de verdade, do
 * jeito que o portal os devolve.
 */

class RoleUserSummaryDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  relationshipId: string;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  userId: string;

  @ApiProperty({ example: 'Ana Costa' })
  name: string;

  @ApiProperty({ nullable: true })
  image: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ enum: ['pending', 'accepted', 'declined'] })
  inviteStatus: string;

  @ApiProperty()
  startDate: Date;

  @ApiProperty({ nullable: true })
  endDate: Date | null;

  @ApiProperty({ nullable: true })
  maxLessonsPerWeek: number | null;

  @ApiProperty({ nullable: true })
  lessonDuration: number | null;

  @ApiProperty()
  totalLessons: number;

  @ApiProperty({ nullable: true, description: 'A próxima aula marcada.' })
  nextLessonAt: Date | null;
}

/** Um aluno, visto pelo professor. */
export class TeacherStudentSummaryDto extends RoleUserSummaryDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  studentId: string;

  @ApiProperty({ nullable: true, example: 'INTERMEDIATE' })
  level: string | null;

  @ApiProperty({ nullable: true, example: 'Piano' })
  mainInstrument: string | null;
}

/** Um professor, visto pelo aluno. */
export class StudentTeacherSummaryDto extends RoleUserSummaryDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  teacherId: string;

  @ApiProperty({ type: [String] })
  specialties: string[];

  @ApiProperty({ type: [String] })
  instruments: string[];

  @ApiProperty()
  isVerified: boolean;
}

export class TeacherProfileDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' }) id: string;
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' }) userId: string;

  @ApiProperty({ nullable: true }) bio: string | null;
  @ApiProperty({ nullable: true }) publicBio: string | null;
  @ApiProperty({ type: [String] }) specialties: string[];
  @ApiProperty({ type: [String] }) instruments: string[];
  @ApiProperty({ type: [String] }) ageGroups: string[];
  @ApiProperty({ type: [String] }) skillLevels: string[];
  @ApiProperty({ type: [String] }) highlightedWorks: string[];
  @ApiProperty({ nullable: true }) experience: string | null;
  @ApiProperty({ nullable: true }) education: string | null;
  @ApiProperty({ nullable: true }) achievements: string | null;
  @ApiProperty({ nullable: true }) teachingMethod: string | null;
  @ApiProperty() isPublicProfile: boolean;
  @ApiProperty({ nullable: true }) profileImage: string | null;
  @ApiProperty({ nullable: true }) website: string | null;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'Endereços de rede, por plataforma.',
  })
  socialMedia: Record<string, unknown> | null;

  @ApiProperty() allowProgressReports: boolean;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  reportPreferences: Record<string, unknown> | null;

  @ApiProperty({ nullable: true }) defaultLessonDuration: number | null;
  @ApiProperty({ nullable: true }) maxStudentsPerWeek: number | null;
  @ApiProperty({ nullable: true }) timezone: string | null;

  @ApiProperty({ enum: ['PENDING', 'ACTIVE', 'INACTIVE'] })
  status: string;

  @ApiProperty({ description: 'Quem verifica é o admin, nunca o professor.' })
  isVerified: boolean;

  @ApiProperty({ nullable: true }) verifiedAt: Date | null;
  @ApiProperty() totalStudents: number;
  @ApiProperty() totalLessons: number;
  @ApiProperty({ nullable: true }) averageRating: number | null;
  @ApiProperty() totalReviews: number;
  @ApiProperty({ nullable: true }) completionRate: number | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class StudentProfileDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' }) id: string;
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' }) userId: string;

  @ApiProperty({ nullable: true, example: 'INTERMEDIATE' })
  level: string | null;

  @ApiProperty({ nullable: true, example: 'Piano' })
  mainInstrument: string | null;

  @ApiProperty({ type: [String] }) musicalGoals: string[];
  @ApiProperty({ type: [String] }) preferredGenres: string[];
  @ApiProperty({ nullable: true }) musicalBackground: string | null;
  @ApiProperty() allowPublicProgress: boolean;
  @ApiProperty() allowProgressShare: boolean;
  @ApiProperty() allowWhatsappMensage: boolean;

  @ApiProperty({ enum: ['public', 'teacher_only', 'private'] })
  profileVisibility: string;

  @ApiProperty({ nullable: true }) practiceTime: number | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  practiceSchedule: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, enum: ['slow', 'medium', 'fast'] })
  learningPace: string | null;

  @ApiProperty({ nullable: true }) specialNeeds: string | null;
  @ApiProperty({ example: 'ACTIVE' }) status: string;
  @ApiProperty() enrollmentDate: Date;
  @ApiProperty({ nullable: true }) lastLessonAt: Date | null;
  @ApiProperty({ nullable: true }) lastActiveAt: Date | null;

  @ApiProperty({ nullable: true, enum: ['whatsapp', 'email', 'both'] })
  preferredContact: string | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  reminderPreferences: Record<string, unknown> | null;

  @ApiProperty() totalLessonsAttended: number;
  @ApiProperty() totalAssignments: number;
  @ApiProperty() completedAssignments: number;
  @ApiProperty() currentStreak: number;
  @ApiProperty() longestStreak: number;
  @ApiProperty({ nullable: true }) progressScore: number | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class TeacherSectionDto {
  @ApiProperty({ type: TeacherProfileDto })
  profile: TeacherProfileDto;

  @ApiProperty({
    description:
      'Verdadeiro quando o perfil foi criado agora — a primeira visita ao ' +
      'portal cria o registro, sem etapa separada.',
  })
  isNew: boolean;

  @ApiProperty({ type: [TeacherStudentSummaryDto] })
  students: TeacherStudentSummaryDto[];
}

export class StudentSectionDto {
  @ApiProperty({ type: StudentProfileDto })
  profile: StudentProfileDto;

  @ApiPropertyOptional({ description: 'Ver `TeacherSectionDto.isNew`.' })
  isNew: boolean;

  @ApiProperty({ type: [StudentTeacherSummaryDto] })
  teachers: StudentTeacherSummaryDto[];
}
