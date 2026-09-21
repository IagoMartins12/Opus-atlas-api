import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthUserDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'aluno@opusatlas.com' })
  email: string;

  @ApiPropertyOptional({ example: 'Maria', nullable: true })
  firstName?: string | null;

  @ApiPropertyOptional({ example: 'Silva', nullable: true })
  lastName?: string | null;

  @ApiProperty({
    example: 0,
    description: '0 = usuário comum, 1 = admin, 2 = super admin',
  })
  role: number;

  @ApiProperty({ example: false })
  isTeacher: boolean;

  @ApiProperty({ example: false })
  isStudent: boolean;
}
