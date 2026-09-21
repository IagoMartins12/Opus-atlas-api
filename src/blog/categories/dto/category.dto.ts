import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryChildDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiPropertyOptional({ nullable: true }) icon?: string | null;
  @ApiPropertyOptional({ nullable: true }) color?: string | null;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
}

export class CategoryParentDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
}

export class CategoryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiPropertyOptional({ nullable: true }) parentId?: string | null;
  @ApiPropertyOptional({ type: CategoryParentDto, nullable: true })
  parent?: CategoryParentDto | null;
  @ApiProperty({ type: [CategoryChildDto] }) children: CategoryChildDto[];
  @ApiProperty() showInMenu: boolean;
  @ApiProperty() isActive: boolean;
  @ApiPropertyOptional({ nullable: true }) image?: string | null;
  @ApiPropertyOptional({ nullable: true }) icon?: string | null;
  @ApiPropertyOptional({ nullable: true }) color?: string | null;
  @ApiPropertyOptional({ nullable: true }) coverImage?: string | null;
  @ApiProperty() order: number;
  @ApiPropertyOptional() articleCount?: number;
}

export class CategoryListResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ type: [CategoryDto] }) categories: CategoryDto[];
}

export class CategoryResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ type: CategoryDto }) category: CategoryDto;
}
