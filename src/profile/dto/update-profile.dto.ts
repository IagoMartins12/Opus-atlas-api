import { ApiPropertyOptional } from '@nestjs/swagger';
import { DifficultyLevel, UserType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  UpdateStudentProfileDto,
  UpdateTeacherProfileDto,
} from '../../portal/profile/dto/role-profile.dto';
import { UserInstrumentInputDto } from './user-instrument.dto';

/**
 * Dados da conta que a própria pessoa edita.
 *
 * Fora, de propósito: `image` (entra por `POST /profile/avatar`, que confere
 * tipo e tamanho — aceitar URL aqui deixava apontar a foto para qualquer
 * endereço externo), `email` (troca com confirmação), `role`, `isTeacher`,
 * `isStudent` e `onboardingCompleted`.
 *
 * O telefone chega inteiro, em E.164; país e número são separados na API, não
 * pelo cliente. Texto em branco vira `null`; `null` nos ids limpa a escolha.
 */
export class UpdateAccountDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  @ApiPropertyOptional({
    example: '+5581999990000',
    description: 'Formato E.164. Vazio apaga o telefone.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ enum: UserType })
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  @ApiPropertyOptional({ enum: DifficultyLevel })
  @IsOptional()
  @IsEnum(DifficultyLevel)
  experienceLevel?: DifficultyLevel;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsMongoId()
  favoriteComposerId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsMongoId()
  favoriteEpochId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: 9999,
    description: 'Horas de prática por semana.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  practiceTimePerWeek?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  profilePublic?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showLocation?: boolean;
}

/**
 * Corpo de `PATCH /profile`: blocos opcionais, validados um a um.
 *
 * Dá para mudar só o telefone, só os instrumentos, ou conta e perfil de aluno
 * na mesma chamada — tudo numa transação.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ type: UpdateAccountDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAccountDto)
  account?: UpdateAccountDto;

  @ApiPropertyOptional({
    type: [UserInstrumentInputDto],
    description: 'Substitui a lista inteira. No máximo um principal.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => UserInstrumentInputDto)
  instruments?: UserInstrumentInputDto[];

  @ApiPropertyOptional({
    type: UpdateTeacherProfileDto,
    description: 'Só para conta de professor.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateTeacherProfileDto)
  teacher?: UpdateTeacherProfileDto;

  @ApiPropertyOptional({
    type: UpdateStudentProfileDto,
    description: 'Só para conta de aluno.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateStudentProfileDto)
  student?: UpdateStudentProfileDto;
}

/**
 * Primeiro preenchimento: o mesmo corpo da atualização, e marca o cadastro
 * como concluído. Bloco de papel que a conta não tem é ignorado.
 */
export class OnboardingDto extends UpdateProfileDto {}
