import { ApiProperty } from '@nestjs/swagger';

export class EmailStatusResponseDto {
  @ApiProperty({ description: 'Se já existe uma conta com este e-mail' })
  exists: boolean;

  @ApiProperty({
    description:
      'Se o e-mail já foi confirmado (só relevante quando `exists` é `true`)',
  })
  verified: boolean;
}
