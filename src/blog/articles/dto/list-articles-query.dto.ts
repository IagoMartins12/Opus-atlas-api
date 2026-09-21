import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArticleStatus, ArticleType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { queryBoolean } from '../../../common/utils/query-boolean';

const toArray = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').filter(Boolean) : value;

export class ListArticlesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  // Sem teto, `?limit=100000` numa rota pública devolve a coleção inteira, com
  // autor, categorias, tags e contagens de cada artigo. O legado também não
  // tinha; o front pede 12.
  @ApiPropertyOptional({ default: 12, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 12;

  @ApiPropertyOptional({
    enum: ArticleStatus,
    description:
      'Só é respeitado para chamadores com role >= ADMIN (1); anônimos/comuns sempre veem só PUBLISHED',
  })
  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @ApiPropertyOptional({ type: [String], enum: ArticleType, isArray: true })
  @IsOptional()
  @Transform(toArray)
  @IsEnum(ArticleType, { each: true })
  types?: ArticleType[];

  @ApiPropertyOptional({ type: [String], description: 'Slugs de categoria' })
  @IsOptional()
  @Transform(toArray)
  @IsString({ each: true })
  categories?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Slugs de tag' })
  @IsOptional()
  @Transform(toArray)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  // Com a conversão implícita ligada, o `value` do `@Transform` já passou por
  // `Boolean(...)`: comparar com o texto transformava `featured=true` em
  // `false`, e aceitar o booleano transformaria `featured=false` em `true`.
  @Transform(queryBoolean)
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsMongoId() composerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() workId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() instrumentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() epochId?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() authorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;

  @ApiPropertyOptional({
    enum: ['newest', 'oldest', 'popular', 'mostRead'],
    default: 'newest',
  })
  @IsOptional()
  @IsIn(['newest', 'oldest', 'popular', 'mostRead'])
  sortBy?: 'newest' | 'oldest' | 'popular' | 'mostRead' = 'newest';
}
