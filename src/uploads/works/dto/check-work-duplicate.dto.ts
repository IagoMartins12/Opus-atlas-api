import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class CheckWorkDuplicateDto {
  @ApiPropertyOptional({
    example:
      'https://imslp.org/wiki/Piano_Sonata_No.14_(Beethoven,_Ludwig_van)',
    description: 'Link do IMSLP. Ou isto, ou título + compositor.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  url?: string;

  @ApiPropertyOptional({ example: 'Sonata para Piano nº 14' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @ApiPropertyOptional({ example: '685d591c1e3db0c5aaa893e4' })
  @IsOptional()
  @IsMongoId()
  composerId?: string;

  @ApiPropertyOptional({
    description: 'Obra sendo editada, excluída da checagem.',
  })
  @IsOptional()
  @IsMongoId()
  excludeId?: string;
}
