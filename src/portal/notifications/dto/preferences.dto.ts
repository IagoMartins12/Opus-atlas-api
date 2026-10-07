import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class ChannelChoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() email?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sms?: boolean;
}

export class UpdatePreferencesDto {
  @ApiPropertyOptional({
    description:
      'Por tema: `{ "lesson-reminder": { "email": true, "sms": false } }`. Temas desconhecidos são ignorados.',
    example: { 'lesson-reminder': { email: true, sms: false } },
  })
  @IsOptional()
  @IsObject()
  channels?: Record<string, ChannelChoiceDto>;

  @ApiPropertyOptional({
    example: '22:00',
    nullable: true,
    description: 'Início do silêncio. `null` tira o silêncio.',
  })
  @IsOptional()
  @Matches(HHMM, { message: 'horário no formato HH:mm' })
  quietHoursStart?: string | null;

  @ApiPropertyOptional({ example: '07:00', nullable: true })
  @IsOptional()
  @Matches(HHMM, { message: 'horário no formato HH:mm' })
  quietHoursEnd?: string | null;
}

export class AnnouncementDto {
  @ApiProperty({
    type: [String],
    description: 'Alunos (Student.id) que recebem.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsMongoId({ each: true })
  studentIds: string[];

  @ApiProperty({ example: 'Recital de novembro' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'O recital será no sábado, 21, às 16h.' })
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({
    type: ChannelChoiceDto,
    description: 'Canais além do portal; valem só para quem aceita.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChannelChoiceDto)
  channels?: ChannelChoiceDto;

  @ApiPropertyOptional({ description: 'Envio agendado. Sem valor: agora.' })
  @IsOptional()
  @IsDateString()
  sendAt?: string;
}
