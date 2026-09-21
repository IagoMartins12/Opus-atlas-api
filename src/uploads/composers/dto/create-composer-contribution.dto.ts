import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsMongoId,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Campos que a comunidade pode enviar ao cadastrar um compositor.
 *
 * A lista é explícita de propósito. O handler do legado fazia
 * `prisma.composer.create({ data: { ...body } })`, espalhando o corpo cru da
 * requisição direto no banco — qualquer usuário podia enviar `isVerified: true`,
 * `verifiedBy` ou `dataQuality` e forjar um cadastro como se já tivesse passado
 * por curadoria. Com o DTO, campo não declarado é descartado pelo
 * `ValidationPipe` global antes de chegar ao service.
 */
export class CreateComposerContributionDto {
  @ApiProperty({
    example: 'Mozart',
    description: 'Nome curto, como aparece no catálogo.',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'Wolfgang Amadeus Mozart' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName: string;

  @ApiProperty({
    example: '685d591c1e3db0c5aaa893e4',
    description: 'Época musical.',
  })
  @IsMongoId()
  epochId: string;

  @ApiProperty({
    example: '685d591c1e3db0c5aaa893e5',
    description: 'Papel principal.',
  })
  @IsMongoId()
  primaryRoleId: string;

  @ApiPropertyOptional({ example: 'Mozart, W. A.; Amadé Mozart' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  alternativeNames?: string;

  @ApiPropertyOptional({ example: '1756-01-27' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  birthDate?: string;

  @ApiPropertyOptional({ example: '1791-12-05' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  deathDate?: string;

  @ApiPropertyOptional({
    description:
      'URL do retrato. Para enviar um arquivo, use POST /uploads/file.',
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(1000)
  portraitUrl?: string;

  @ApiPropertyOptional({ example: 'Clássico' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  epochName?: string;

  @ApiPropertyOptional({ description: 'Biografia resumida.' })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  bio?: string;

  @ApiPropertyOptional({
    description:
      'Biografia em inglês. Substitui o `biography/save` do legado, que gravava num JSON em disco.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  bioEn?: string;

  @ApiPropertyOptional({ example: 'Category:Mozart,_Wolfgang_Amadeus' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imslpId?: string;

  @ApiPropertyOptional({
    example: 'https://imslp.org/wiki/Category:Mozart,_Wolfgang_Amadeus',
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(1000)
  permLinkImslp?: string;

  @ApiPropertyOptional({ example: 'https://pt.wikipedia.org/wiki/Mozart' })
  @IsOptional()
  @IsUrl()
  @MaxLength(1000)
  wikipediaLink?: string;

  @ApiPropertyOptional({ example: 'https://youtube.com/watch?v=abc' })
  @IsOptional()
  @IsUrl()
  @MaxLength(1000)
  videoUrl?: string;

  @ApiPropertyOptional({ example: 'Austríaco' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nationality?: string;

  @ApiPropertyOptional({ example: 'Piano, Violino' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instruments?: string;

  @ApiPropertyOptional({ example: 'Classical composers' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  imslpCategories?: string;

  @ApiPropertyOptional({ example: 'Compositor, Pianista' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  roles?: string;

  @ApiPropertyOptional({
    example: 'imslp',
    description: 'De onde vieram os dados: imslp, wikipedia, manual ou none.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  dataSource?: string;
}
