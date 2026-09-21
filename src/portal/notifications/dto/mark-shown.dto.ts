import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class MarkShownDto {
  @ApiProperty({
    enum: ['toast', 'browser'],
    description: 'Canal em que a notificação foi exibida.',
  })
  @IsIn(['toast', 'browser'])
  channel: 'toast' | 'browser';
}
