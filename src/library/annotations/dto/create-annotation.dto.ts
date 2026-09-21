import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AnnotationCategory,
  AnnotationDifficulty,
  AnnotationScope,
} from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class CreateAnnotationDto {
  @ApiProperty() @IsMongoId() workId: string;

  @ApiProperty({ minLength: 3, maxLength: 100 })
  @IsString()
  @Length(3, 100)
  title: string;

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @Length(10, 2000)
  content: string;

  @ApiPropertyOptional({
    enum: AnnotationCategory,
    default: AnnotationCategory.GENERAL,
  })
  @IsOptional()
  @IsEnum(AnnotationCategory)
  category?: AnnotationCategory = AnnotationCategory.GENERAL;

  @ApiPropertyOptional({
    enum: AnnotationScope,
    default: AnnotationScope.ENTIRE_WORK,
  })
  @IsOptional()
  @IsEnum(AnnotationScope)
  scope?: AnnotationScope = AnnotationScope.ENTIRE_WORK;

  @ApiPropertyOptional() @IsOptional() @IsInt() measureStart?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() measureEnd?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() movement?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() section?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() pageNumber?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() hand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() voice?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() instrument?: string;

  @ApiPropertyOptional({
    enum: AnnotationDifficulty,
    default: AnnotationDifficulty.ALL_LEVELS,
  })
  @IsOptional()
  @IsEnum(AnnotationDifficulty)
  difficulty?: AnnotationDifficulty = AnnotationDifficulty.ALL_LEVELS;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[] = [];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean = true;
}
