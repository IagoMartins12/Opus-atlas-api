import { ApiProperty } from '@nestjs/swagger';

export class EpochItemDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Romântico' })
  name: string;
}
