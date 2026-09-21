import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryRefDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiPropertyOptional({ nullable: true }) color?: string | null;
  @ApiPropertyOptional({ nullable: true }) icon?: string | null;
}

export const CATEGORY_REF_SELECT = {
  id: true,
  name: true,
  slug: true,
  color: true,
  icon: true,
} as const;
