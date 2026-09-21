import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class HeartbeatDto {
  @ApiPropertyOptional({
    description: 'Epoch ms; usa o horário do servidor se ausente',
  })
  @IsOptional()
  @IsInt()
  timestamp?: number;

  @ApiPropertyOptional({ example: 'periodic' })
  @IsOptional()
  @IsString()
  type?: string;
}
