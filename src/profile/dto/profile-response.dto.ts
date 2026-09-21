import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DifficultyLevel,
  PlanType,
  StudentInviteStatus,
  UserType,
} from '@prisma/client';
import { UserInstrumentDto } from './user-instrument.dto';
import {
  StudentSectionDto,
  TeacherSectionDto,
} from '../../portal/profile/dto/role-section.dto';

export class LoginInfoDto {
  @ApiProperty({ description: 'A conta tem senha própria' })
  hasPassword: boolean;

  @ApiProperty({ type: [String], example: ['google'] })
  providers: string[];
}

/** A conta, como `GET /profile` a devolve — é o que a sessão do front usa. */
export class ProfileAccountDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({ nullable: true }) email: string | null;
  @ApiPropertyOptional({ nullable: true }) username: string | null;
  @ApiPropertyOptional({ nullable: true }) firstName: string | null;
  @ApiPropertyOptional({ nullable: true }) lastName: string | null;
  @ApiProperty({ description: 'Nome e sobrenome juntos' }) name: string;
  @ApiPropertyOptional({ nullable: true }) image: string | null;
  @ApiPropertyOptional({ nullable: true }) bio: string | null;
  @ApiProperty({ description: '0 = usuário, 1 = admin, 2 = super admin' })
  role: number;
  @ApiProperty() isTeacher: boolean;
  @ApiProperty() isStudent: boolean;
  @ApiPropertyOptional({ nullable: true, enum: UserType })
  userType: UserType | null;
  @ApiProperty() onboardingCompleted: boolean;
  @ApiPropertyOptional({ nullable: true }) emailVerified: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ nullable: true }) lastSeen: Date | null;
  @ApiPropertyOptional({ nullable: true }) city: string | null;
  @ApiPropertyOptional({ nullable: true }) state: string | null;
  @ApiPropertyOptional({ nullable: true }) country: string | null;
  @ApiPropertyOptional({ nullable: true }) phone: string | null;
  @ApiPropertyOptional({ nullable: true }) phoneCountryCode: string | null;
  @ApiPropertyOptional({ nullable: true }) phoneNumber: string | null;
  @ApiPropertyOptional({ nullable: true }) favoriteComposerId: string | null;
  @ApiPropertyOptional({ nullable: true }) favoriteEpochId: string | null;
  @ApiProperty({ enum: DifficultyLevel }) experienceLevel: DifficultyLevel;
  @ApiPropertyOptional({ nullable: true }) practiceTimePerWeek: number | null;
  @ApiProperty() profilePublic: boolean;
  @ApiProperty() showLocation: boolean;
  @ApiProperty({ enum: PlanType }) currentPlan: PlanType;
  @ApiPropertyOptional({ nullable: true }) planExpiresAt: Date | null;
  @ApiProperty() isTrialActive: boolean;
  @ApiProperty() totalXP: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Professor aprovado pelo admin. `null` para quem não é professor.',
  })
  teacherVerified: boolean | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: StudentInviteStatus,
    description:
      'Aceito se algum vínculo ativo foi aceito; senão, o do vínculo mais recente. `null` para quem não é aluno.',
  })
  studentInviteStatus: StudentInviteStatus | null;

  @ApiProperty({ type: LoginInfoDto }) login: LoginInfoDto;
}

export class ProfileStatsDto {
  @ApiProperty() instrumentsCount: number;
  @ApiProperty() favoriteWorksCount: number;
  @ApiProperty() favoriteComposersCount: number;
  @ApiProperty() learnedWorksCount: number;
}

export class ProfileResponseDto {
  @ApiProperty({ type: ProfileAccountDto }) account: ProfileAccountDto;

  @ApiPropertyOptional({ type: [UserInstrumentDto] })
  instruments?: UserInstrumentDto[];

  @ApiPropertyOptional({ type: ProfileStatsDto }) stats?: ProfileStatsDto;

  @ApiPropertyOptional({
    type: TeacherSectionDto,
    nullable: true,
    description:
      '`null` para quem não é professor; criado na primeira leitura para ' +
      'quem é.',
  })
  teacher?: TeacherSectionDto | null;

  @ApiPropertyOptional({
    type: StudentSectionDto,
    nullable: true,
    description:
      '`null` para quem não é aluno; criado na primeira leitura para quem é.',
  })
  student?: StudentSectionDto | null;
}

export class CascadeSampleComposerDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) epochName?: string | null;
}

export class CascadeSampleWorkDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() composer: { name: string };
}

export class CascadeSampleAnnotationDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() work: { title: string };
}

export class AccountCascadeInfoDto {
  @ApiProperty() totalItems: number;
  @ApiProperty() composersCount: number;
  @ApiProperty() worksCount: number;
  @ApiProperty() scoresCount: number;
  @ApiProperty() annotationsCount: number;
  @ApiProperty() favoritesCount: number;
  @ApiProperty() instrumentsCount: number;
  @ApiProperty() favoriteComposersCount: number;
  @ApiProperty() learnedWorksCount: number;
  @ApiProperty() wantToLearnCount: number;
  @ApiProperty({ type: [CascadeSampleComposerDto] })
  sampleComposers: CascadeSampleComposerDto[];
  @ApiProperty({ type: [CascadeSampleWorkDto] })
  sampleWorks: CascadeSampleWorkDto[];
  @ApiProperty({ type: [CascadeSampleAnnotationDto] })
  sampleAnnotations: CascadeSampleAnnotationDto[];
}

export class DeleteAccountResponseDto {
  @ApiProperty() deletedAt: string;
  @ApiPropertyOptional({ nullable: true }) email?: string | null;
  @ApiProperty() name: string;
}

export class HeartbeatResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty() timestamp: string;
}
