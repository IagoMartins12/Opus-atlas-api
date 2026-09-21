import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';

export class ToggleWorkFavoriteDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa89abc' })
  @IsMongoId()
  workId: string;

  @ApiProperty({ enum: ['add', 'remove'] })
  @IsIn(['add', 'remove'])
  action: 'add' | 'remove';
}
