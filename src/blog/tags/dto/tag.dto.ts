import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TagDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiPropertyOptional({ nullable: true }) color?: string | null;
  @ApiProperty() articleCount: number;
  @ApiProperty() createdAt: Date;
}

export class TagListResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ type: [TagDto] }) tags: TagDto[];
}

export class TagResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ type: TagDto }) tag: TagDto;
}
