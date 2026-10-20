import { ApiProperty } from '@nestjs/swagger';

class SitemapComposerDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Frédéric François Chopin' })
  name: string;

  @ApiProperty()
  lastModified: Date;
}

class SitemapWorkDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Sonata No. 2 em Si bemol menor' })
  title: string;

  @ApiProperty()
  lastModified: Date;
}

class SitemapArticleDto {
  @ApiProperty({ example: 'como-ler-uma-partitura' })
  slug: string;

  @ApiProperty()
  lastModified: Date;
}

class SitemapSlugDto {
  @ApiProperty({ example: 'historia' })
  slug: string;

  @ApiProperty({ description: 'Data do artigo mais recente da página' })
  lastModified: Date;
}

class SitemapAuthorDto {
  @ApiProperty({
    example: 'helena-prado',
    description: 'Nome de usuário; o id quando a conta não tem um.',
  })
  id: string;

  @ApiProperty({ description: 'Data do artigo mais recente do autor' })
  lastModified: Date;
}

class SitemapTeacherDto {
  @ApiProperty({
    example: '685d591c1e3db0c5aaa893e4',
    description: 'O id do usuário — é o que a URL pública usa.',
  })
  id: string;

  @ApiProperty()
  lastModified: Date;
}

/**
 * Quem entra no sitemap e quando mudou. O XML é montado pelo Next, dono do
 * domínio e do formato das URLs; aqui vai só o conteúdo.
 */
export class SitemapEntriesDto {
  @ApiProperty({ example: '2026-09-19T12:00:00.000Z' })
  generatedAt: string;

  @ApiProperty({ type: [SitemapComposerDto] })
  composers: SitemapComposerDto[];

  @ApiProperty({ type: [SitemapWorkDto] })
  works: SitemapWorkDto[];

  @ApiProperty({ type: [SitemapArticleDto] })
  articles: SitemapArticleDto[];

  @ApiProperty({
    type: [SitemapSlugDto],
    description: 'Categorias do blog ativas e com artigo publicado',
  })
  blogCategories: SitemapSlugDto[];

  @ApiProperty({
    type: [SitemapSlugDto],
    description: 'Tags do blog com artigo publicado',
  })
  blogTags: SitemapSlugDto[];

  @ApiProperty({
    type: [SitemapAuthorDto],
    description: 'Autores com artigo publicado',
  })
  blogAuthors: SitemapAuthorDto[];

  @ApiProperty({ type: [SitemapTeacherDto] })
  teachers: SitemapTeacherDto[];
}
