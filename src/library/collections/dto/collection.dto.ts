import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CollectionFaceDto {
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  portraitUrl!: string | null;
}

/**
 * One item, already resolved for display. Which fields are set depends on
 * the collection's kind; the front composes the line in its language.
 */
export class CollectionEntryDto {
  @ApiProperty() refId!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) note!: string | null;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  opOrCatalog!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  composerName!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  portraitUrl!: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  birthYear!: number | null;
  @ApiPropertyOptional({ nullable: true, type: Number })
  deathYear!: number | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  nationality!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  instrumentName!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Partitura: a obra',
  })
  workId!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  workTitle!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  pageCount!: string | null;
}

export class CollectionOwnerDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class CollectionSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['WORK', 'COMPOSER', 'SCORE'] }) kind!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  description!: string | null;
  @ApiProperty() isPublic!: boolean;
  @ApiProperty() featuredOnHome!: boolean;
  @ApiProperty({ description: 'Fora do ar por denúncia (só o dono vê).' })
  held!: boolean;
  @ApiProperty() favoritesCount!: number;
  @ApiProperty() itemCount!: number;
  @ApiProperty() updatedAt!: Date;
  @ApiProperty({ type: CollectionOwnerDto }) owner!: CollectionOwnerDto;
  @ApiProperty({ type: [CollectionFaceDto] }) faces!: CollectionFaceDto[];
  @ApiProperty({ description: 'Quem chama é o dono.' }) mine!: boolean;
  @ApiProperty({ description: 'Quem chama favoritou.' }) favorited!: boolean;
}

export class CollectionDetailDto extends CollectionSummaryDto {
  @ApiProperty({ type: [CollectionEntryDto] }) items!: CollectionEntryDto[];
}

export class CollectionListDto {
  @ApiProperty({ type: [CollectionSummaryDto] })
  collections!: CollectionSummaryDto[];
  @ApiProperty() total!: number;
}

export class MyCollectionsDto {
  @ApiProperty({ type: [CollectionSummaryDto] }) mine!: CollectionSummaryDto[];
  @ApiProperty({ type: [CollectionSummaryDto] })
  favorites!: CollectionSummaryDto[];
}
