import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DuplicateWorkDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) subtitle: string | null;
  @ApiProperty({ nullable: true }) opOrCatalog: string | null;
  @ApiProperty({ nullable: true }) imslpPermlink: string | null;
  @ApiProperty({ nullable: true }) composerName: string | null;
}

export class WorkDuplicateResponseDto {
  @ApiProperty() found: boolean;

  @ApiPropertyOptional({ type: DuplicateWorkDto, nullable: true })
  work?: DuplicateWorkDto | null;

  @ApiPropertyOptional({
    example: 'title_composer',
    description: 'O que casou: "url" ou "title_composer".',
  })
  reason?: string;
}
