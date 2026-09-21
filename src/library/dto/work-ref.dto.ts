import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComposerNameRefDto } from './composer-ref.dto';

/** Referência enxuta de obra, embutida em respostas de favoritos/aprendizado/anotações. */
export class WorkRefDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ nullable: true }) opOrCatalog?: string | null;
  @ApiProperty({ type: ComposerNameRefDto }) composer: ComposerNameRefDto;
}

export class WorkRefWithInstrumentDto extends WorkRefDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Nome do instrumento principal da obra',
  })
  instrument?: { name: string } | null;
}
