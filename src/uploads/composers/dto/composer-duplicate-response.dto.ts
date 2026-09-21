import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DuplicateComposerDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ nullable: true }) portraitUrl: string | null;
  @ApiProperty({ nullable: true }) nationality: string | null;
  @ApiProperty({ nullable: true }) birthDate: string | null;
  @ApiProperty({ nullable: true }) deathDate: string | null;
  @ApiProperty({ nullable: true }) epochName: string | null;
  @ApiProperty({ nullable: true }) imslpId: string | null;
  @ApiProperty({ nullable: true }) permLinkImslp: string | null;
  @ApiProperty({ nullable: true }) wikipediaLink: string | null;
}

export class ComposerDuplicateResponseDto {
  @ApiProperty({
    description: 'Verdadeiro quando já existe um compositor equivalente.',
  })
  found: boolean;

  @ApiPropertyOptional({ type: DuplicateComposerDto, nullable: true })
  composer?: DuplicateComposerDto | null;

  @ApiPropertyOptional({
    example: 'nome',
    description: 'O que casou: "link do IMSLP", "link da Wikipedia" ou "nome".',
  })
  reason?: string;

  @ApiPropertyOptional({ example: 'Wolfgang Amadeus Mozart' })
  matchDetails?: string;
}
