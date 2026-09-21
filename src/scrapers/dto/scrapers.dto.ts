import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class SetScraperScheduleDto {
  @ApiProperty({
    example: '0 3 * * *',
    description:
      'Expressão cron de cinco campos, no fuso America/Sao_Paulo. Madrugada é ' +
      'a hora certa: é quando o site da casa tem menos gente e a rodada não ' +
      'disputa recursos com o tráfego de usuário.',
  })
  @IsString()
  @MaxLength(100)
  cron!: string;
}
