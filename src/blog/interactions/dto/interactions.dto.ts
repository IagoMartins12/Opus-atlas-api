import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_READ_SECONDS } from '../read-time';

export class BookmarkArticleDto {
  @ApiPropertyOptional({ maxLength: 1000, description: 'Nota pessoal' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  // O front do legado manda o id do artigo também no corpo. Ele é aceito e
  // ignorado — o que vale é o do caminho —, para a validação estrita não
  // transformar a chamada de hoje em 400.
  @ApiHideProperty()
  @IsOptional()
  @IsMongoId()
  articleId?: string;
}

export class ReadArticleDto {
  @ApiProperty({
    minimum: 1,
    maximum: MAX_READ_SECONDS,
    description: 'Tempo de leitura, em segundos',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_READ_SECONDS)
  readTime!: number;
}

export class SavedArticlesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 12, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 12;

  @ApiPropertyOptional({
    description: 'Slug da categoria; `all` ou vazio para todas',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(all|[a-z0-9]+(?:-[a-z0-9]+)*)$/, {
    message: 'categoria é um slug (ex.: "romantico") ou "all"',
  })
  category?: string;
}
