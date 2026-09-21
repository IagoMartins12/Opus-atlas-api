import { Module } from '@nestjs/common';
import { ArticlesModule } from './articles/articles.module';
import { CategoriesModule } from './categories/categories.module';
import { TagsModule } from './tags/tags.module';
import { SearchModule } from './search/search.module';
import { CommentsModule } from './comments/comments.module';
import { InteractionsModule } from './interactions/interactions.module';
import { BlogMediaModule } from './media/blog-media.module';
import { BlogCalendarModule } from './calendar/blog-calendar.module';
import { TtsModule } from './tts/tts.module';

/**
 * O blog: artigos (leitura e escrita), categorias, tags, busca, comentários,
 * interações com o artigo, mídia, o calendário de eventos com os locais, e o
 * áudio "ouvir o artigo".
 */
@Module({
  imports: [
    ArticlesModule,
    CategoriesModule,
    TagsModule,
    SearchModule,
    CommentsModule,
    InteractionsModule,
    BlogMediaModule,
    BlogCalendarModule,
    TtsModule,
  ],
})
export class BlogModule {}
