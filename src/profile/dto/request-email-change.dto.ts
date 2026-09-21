import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class RequestEmailChangeDto {
  @ApiProperty({ example: 'novo-email@opusatlas.com' })
  @IsEmail()
  newEmail: string;

  @ApiProperty()
  @IsString()
  currentPassword: string;
}
