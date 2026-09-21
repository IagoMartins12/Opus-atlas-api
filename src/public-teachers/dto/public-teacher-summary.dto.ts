import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicTeacherSummaryDto {
  @ApiProperty({
    description: 'ID do usuário professor (não o ID do registro `Teacher`)',
    example: '685d591c1e3db0c5aaa893e4',
  })
  id: string;

  @ApiProperty({ example: 'Maria Silva' })
  name: string;

  @ApiPropertyOptional({ nullable: true })
  profileImage?: string | null;

  @ApiPropertyOptional({ nullable: true })
  bio?: string | null;

  @ApiPropertyOptional({ nullable: true })
  publicBio?: string | null;

  @ApiProperty({ type: [String], example: ['Piano', 'Teoria Musical'] })
  specialties: string[];

  @ApiProperty({ type: [String], example: ['Piano', 'Violão'] })
  instruments: string[];

  @ApiPropertyOptional({ nullable: true, example: '10 anos' })
  experience?: string | null;

  @ApiPropertyOptional({ nullable: true })
  education?: string | null;

  @ApiPropertyOptional({ nullable: true })
  achievements?: string | null;

  @ApiPropertyOptional({ nullable: true })
  website?: string | null;

  @ApiPropertyOptional({ nullable: true })
  socialMedia?: unknown;

  @ApiProperty({ type: [String] })
  highlightedWorks: string[];

  @ApiPropertyOptional({ nullable: true })
  teachingMethod?: string | null;

  @ApiProperty({ type: [String], example: ['Crianças', 'Adultos'] })
  ageGroups: string[];

  @ApiProperty({ type: [String], example: ['Iniciante', 'Intermediário'] })
  skillLevels: string[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Só exposto quando o professor optou por perfil público',
  })
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'São Paulo, SP' })
  location?: string | null;

  @ApiProperty({ example: true })
  isVerified: boolean;

  @ApiPropertyOptional({ nullable: true, example: 4.8 })
  averageRating?: number | null;

  @ApiProperty({ example: 32 })
  totalReviews: number;

  @ApiProperty({ example: 15 })
  totalStudents: number;

  @ApiProperty({ example: 420 })
  totalLessons: number;

  @ApiPropertyOptional({ nullable: true, example: 0.94 })
  completionRate?: number | null;

  @ApiProperty({ example: '2022-03-01T00:00:00.000Z' })
  teachingSince: Date;

  @ApiProperty({ example: 3 })
  yearsExperience: number;
}
