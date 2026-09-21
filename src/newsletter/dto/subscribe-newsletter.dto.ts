import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class SubscribeNewsletterDto {
  @ApiProperty({ example: 'visitante@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 'Maria' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Silva' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ type: [String], example: ['piano', 'barroco'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];

  @ApiPropertyOptional({
    enum: ['daily', 'weekly', 'monthly'],
    default: 'weekly',
  })
  @IsOptional()
  @IsIn(['daily', 'weekly', 'monthly'])
  frequency?: string;

  @ApiPropertyOptional({ description: 'De onde veio a inscrição' })
  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @ApiPropertyOptional({ description: 'UTM source para atribuição' })
  @IsOptional()
  @IsString()
  utmSource?: string;
}
