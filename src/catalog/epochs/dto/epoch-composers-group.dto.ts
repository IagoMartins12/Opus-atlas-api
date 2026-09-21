import { ApiProperty } from '@nestjs/swagger';
import { EpochComposerItemDto } from './epoch-composer-item.dto';

export class EpochComposersGroupDto {
  @ApiProperty({ example: '685d59f31e3db0c5aaa89439' })
  epochId: string;

  @ApiProperty({ example: 'Romântico' })
  epochName: string;

  @ApiProperty({
    type: [EpochComposerItemDto],
    description:
      'Até 12 compositores curados desta época, em ordem de nascimento',
  })
  composers: EpochComposerItemDto[];
}
