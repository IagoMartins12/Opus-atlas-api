import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InstrumentItemDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Piano' })
  name: string;

  @ApiPropertyOptional({ example: 'Teclado', nullable: true })
  category?: string | null;

  @ApiPropertyOptional({ example: 'Intermediário', nullable: true })
  difficulty?: string | null;
}
