import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ResubscribeNewsletterDto {
  @ApiProperty({ example: 'visitante@example.com' })
  @IsEmail()
  email: string;
}
