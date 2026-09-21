import { collectMediaUrls } from '../articles/content/media-urls';

export type UsageType =
  | 'cover'
  | 'content'
  | 'background-music'
  | 'gallery'
  | 'category';

export interface MediaUsage {
  owner: 'article' | 'category';
  id: string;
  title: string;
  slug: string;
  usageType: UsageType;
}

export interface UsageSources {
  articles: {
    id: string;
    title: string;
    slug: string;
    coverImage: string | null;
    backgroundMusicUrl: string | null;
    content: unknown;
  }[];
  categories: {
    id: string;
    name: string;
    slug: string;
    image: string | null;
    coverImage: string | null;
  }[];
  media: {
    url: string;
    thumbnailUrl: string | null;
    article: { id: string; title: string; slug: string };
  }[];
}

/**
 * Onde cada arquivo é usado.
 *
 * **O legado só olhava artigos fora de rascunho** (`status: { not: 'DRAFT' }`)
 * ao procurar uso no conteúdo: um arquivo usado apenas num rascunho aparecia
 * como "não usado" na galeria — e apagá-lo quebrava o rascunho. Aqui todo
 * artigo conta, e também categoria e galeria do artigo.
 */
export function buildUsage(sources: UsageSources): Map<string, MediaUsage[]> {
  const usage = new Map<string, MediaUsage[]>();

  const add = (url: string | null | undefined, entry: MediaUsage) => {
    if (!url) return;

    const list = usage.get(url) ?? [];

    if (
      !list.some(
        (item) =>
          item.owner === entry.owner &&
          item.id === entry.id &&
          item.usageType === entry.usageType,
      )
    ) {
      list.push(entry);
    }

    usage.set(url, list);
  };

  for (const article of sources.articles) {
    const base = {
      owner: 'article' as const,
      id: article.id,
      title: article.title,
      slug: article.slug,
    };

    add(article.coverImage, { ...base, usageType: 'cover' });
    add(article.backgroundMusicUrl, { ...base, usageType: 'background-music' });

    for (const url of collectMediaUrls(article.content)) {
      add(url, { ...base, usageType: 'content' });
    }
  }

  for (const category of sources.categories) {
    const base = {
      owner: 'category' as const,
      id: category.id,
      title: category.name,
      slug: category.slug,
      usageType: 'category' as const,
    };

    add(category.image, base);
    add(category.coverImage, base);
  }

  for (const media of sources.media) {
    const base = {
      owner: 'article' as const,
      id: media.article.id,
      title: media.article.title,
      slug: media.article.slug,
      usageType: 'gallery' as const,
    };

    add(media.url, base);
    add(media.thumbnailUrl, base);
  }

  return usage;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
