import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';

export class ToggleComposerFavoriteDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  @IsMongoId()
  composerId: string;

  @ApiProperty({ enum: ['add', 'remove'] })
  @IsIn(['add', 'remove'])
  action: 'add' | 'remove';
}
