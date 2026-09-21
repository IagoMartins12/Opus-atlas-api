import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Referência enxuta de compositor, embutida em respostas de favoritos/anotações. */
export class ComposerRefDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) fullName?: string | null;
  @ApiPropertyOptional({ nullable: true }) portraitUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) epochName?: string | null;
}

/** Referência mínima (só o nome) — usada onde o legado só selecionava `name`/`fullName`. */
export class ComposerNameRefDto {
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) fullName?: string | null;
}
