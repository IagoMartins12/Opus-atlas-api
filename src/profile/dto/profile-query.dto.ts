import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

/** Partes do perfil. `account` vem sempre; as outras, quando pedidas. */
export const PROFILE_SECTIONS = [
  'account',
  'instruments',
  'stats',
  'teacher',
  'student',
] as const;

export const OPTIONAL_PROFILE_SECTIONS = [
  'instruments',
  'stats',
  'teacher',
  'student',
] as const;

const SECTION = PROFILE_SECTIONS.join('|');
const INCLUDE_PATTERN = new RegExp(`^(${SECTION})(,(${SECTION}))*$`);

export class ProfileQueryDto {
  @ApiPropertyOptional({
    description:
      'Partes do perfil, separadas por vírgula: ' +
      `${PROFILE_SECTIONS.join(', ')}. Sem o parâmetro, vem tudo. ` +
      '`account` sozinho é o "quem sou eu": só a conta, para cada navegação.',
    example: 'account',
  })
  @IsOptional()
  @IsString()
  @Matches(INCLUDE_PATTERN, {
    message: `include aceita, separados por vírgula: ${PROFILE_SECTIONS.join(', ')}`,
  })
  include?: string;
}
