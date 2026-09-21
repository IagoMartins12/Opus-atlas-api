import { ApiProperty } from '@nestjs/swagger';

export class WorkGenreItemDto {
  @ApiProperty({ example: '685d5a1c1e3db0c5aaa89512' })
  id: string;

  @ApiProperty({ example: 'Sonata' })
  name: string;
}
