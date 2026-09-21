import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class MediaSearchRequestDto {
  @ApiProperty({
    description: 'ID da obra que receberá a busca automática de mídia',
    example: '68d6ef3758b5d09465856c02',
  })
  @IsString()
  workId: string;

  @ApiPropertyOptional({
    description:
      'Quando verdadeiro, força nova busca mesmo se a obra já possuir mídia',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean = false;
}
