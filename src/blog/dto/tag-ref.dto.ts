import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TagRefDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiPropertyOptional({ nullable: true }) color?: string | null;
}

export const TAG_REF_SELECT = {
  id: true,
  name: true,
  slug: true,
  color: true,
} as const;
