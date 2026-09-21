import { ApiProperty } from '@nestjs/swagger';

export class EmailChangeResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Email alterado com sucesso!' })
  message: string;

  @ApiProperty({ example: 'antigo@opusatlas.com' })
  oldEmail: string;

  @ApiProperty({ example: 'novo@opusatlas.com' })
  newEmail: string;
}
