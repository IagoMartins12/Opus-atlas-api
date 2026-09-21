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

  @ApiProperty({ type: [SitemapTeacherDto] })
  teachers: SitemapTeacherDto[];
}
