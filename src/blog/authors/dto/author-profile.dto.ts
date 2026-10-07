import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthorRefWithBioDto } from '../../dto/author-ref.dto';

export class AuthorCategoryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiProperty({ description: 'Artigos publicados do autor nesta categoria' })
  articles: number;
}

export class AuthorStatsDto {
  @ApiProperty({ description: 'Artigos publicados' }) articles: number;
  @ApiProperty({ description: 'Visitas somadas dos artigos publicados' })
  views: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Data do primeiro artigo publicado',
  })
  firstPublishedAt: Date | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Data do artigo publicado mais recente',
  })
  lastPublishedAt: Date | null;
}

export class AuthorProfileResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ type: AuthorRefWithBioDto }) author: AuthorRefWithBioDto;
  @ApiProperty({ type: AuthorStatsDto }) stats: AuthorStatsDto;
  @ApiProperty({
    type: [AuthorCategoryDto],
    description: 'As categorias em que o autor escreve, da mais usada à menos',
  })
  categories: AuthorCategoryDto[];
}
