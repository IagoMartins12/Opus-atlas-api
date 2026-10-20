import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class StartCatalogJobDto {
  @ApiPropertyOptional({
    description: 'Grava de verdade. Sem isto, só simula.',
  })
  @IsOptional()
  @IsBoolean()
  apply?: boolean;

  @ApiPropertyOptional({
    description: 'Obrigatório para gravar nas rotinas que juntam ou apagam.',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;

  @ApiPropertyOptional({ description: 'Quantos itens ler nesta rodada.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pausa entre leituras externas, em ms.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60000)
  pause?: number;
}
