import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

export class ComposerCountQueryDto {
  @ApiPropertyOptional({
    description: 'Busca por nome ou nome completo do compositor',
    example: 'bach',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filtra por época',
    example: '685d591c1e3db0c5aaa893e4',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  epochId?: string;
}
