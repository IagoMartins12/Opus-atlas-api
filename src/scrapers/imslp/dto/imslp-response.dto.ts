import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CatalogCandidateDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Chopin' })
  name: string;
}

/**
 * A ficha de um compositor lida no IMSLP. **Nada é gravado**: quem decide o
 * que virar cadastro é o formulário de envio, com revisão — dado de raspagem
 * não é curadoria.
 */
export class ScrapedImslpComposerDto {
  @ApiProperty({
    example: 'Chopin',
    description: 'Sobrenome, como o catálogo guarda.',
  })
  name: string;

  @ApiProperty({ example: 'Frédéric François Chopin' })
  fullName: string;

  @ApiProperty({ nullable: true }) alternativeNames: string | null;
  @ApiProperty({ nullable: true }) birthDate: string | null;
  @ApiProperty({ nullable: true }) deathDate: string | null;
  @ApiProperty({ nullable: true }) portraitUrl: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Sempre nulo aqui: a página do IMSLP não traz prosa.',
  })
  bio: string | null;

  @ApiProperty() imslpId: string;
  @ApiProperty({ nullable: true }) wikipediaLink: string | null;
  @ApiProperty({ nullable: true }) nationality: string | null;
  @ApiProperty({ nullable: true }) instruments: string | null;
  @ApiProperty({ nullable: true }) imslpCategories: string | null;
  @ApiProperty({ nullable: true }) primaryRole: string | null;
  @ApiProperty({ nullable: true }) roles: string | null;

  @ApiProperty({ enum: ['high', 'medium', 'low'] })
  pageQuality: string;

  @ApiProperty({
    example: 80,
    description: 'Quanto da ficha veio, de 0 a 100.',
  })
  dataCompleteness: number;

  @ApiProperty() hasValidImage: boolean;

  @ApiProperty({
    description: 'Sugerida pelo ano de nascimento; confirma gente.',
  })
  epochName: string;

  @ApiProperty({
    nullable: true,
    description: 'Id no catálogo, quando o compositor já existe aqui.',
  })
  composerId: string | null;

  @ApiProperty({
    type: [CatalogCandidateDto],
    description: 'Candidatos, quando a busca não foi conclusiva.',
  })
  composerCandidates: CatalogCandidateDto[];
}

/** A ficha de uma obra lida no IMSLP. Também não grava nada. */
export class ScrapedWorkDto {
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true }) subtitle: string | null;
  @ApiProperty() imslpPermlink: string;
  @ApiProperty() imslpId: string;
  @ApiProperty({ nullable: true }) composerName: string | null;
  @ApiProperty({ nullable: true }) composerPermLink: string | null;

  @ApiProperty({ nullable: true })
  composerId: string | null;

  @ApiProperty({
    type: [CatalogCandidateDto],
    description:
      'Candidatos quando a busca não foi conclusiva. Atribuir a obra ao ' +
      'compositor errado é pior do que deixá-la sem compositor: o erro fica ' +
      'invisível no catálogo.',
  })
  composerCandidates: CatalogCandidateDto[];

  @ApiProperty({ nullable: true }) opOrCatalog: string | null;
  @ApiProperty({ nullable: true }) compositionYear: string | null;
  @ApiProperty({ nullable: true }) firstPublishDate: string | null;
  @ApiProperty({ nullable: true }) tone: string | null;
  @ApiProperty({ nullable: true }) tempoMarking: string | null;
  @ApiProperty({ nullable: true }) mediaDuration: string | null;
  @ApiProperty({ nullable: true }) workStyle: string | null;
  @ApiProperty({ nullable: true }) moviment: string | null;
  @ApiProperty({ nullable: true }) instrumentation: string | null;
  @ApiProperty({ nullable: true }) dedicateTo: string | null;
  @ApiProperty({ type: [String] }) categoryNames: string[];
  @ApiProperty({ type: [String] }) workGenresArr: string[];
  @ApiProperty({ example: 'INDIVIDUAL' }) workType: string;
  @ApiProperty({ nullable: true }) primaryInstrument: string | null;
  @ApiProperty({ nullable: true }) movementNumber: number | null;

  @ApiProperty({
    type: [String],
    description: 'As categorias cruas da página.',
  })
  imslpTags: string[];

  @ApiProperty({ example: 'INTERMEDIATE', description: 'Palpite grosseiro.' })
  difficultyLevel: string;

  @ApiProperty({ nullable: true })
  epochName: string | null;

  @ApiProperty({ example: 70 })
  dataCompleteness: number;

  @ApiProperty({ enum: ['high', 'medium', 'low'] })
  pageQuality: string;
}

/**
 * O compositor como o IMSLP o identifica, na descoberta de obras.
 *
 * **Renomeada.** Chamava-se `DiscoveryComposerDto`, o mesmo nome da classe em
 * `catalog/discovery/dto/discovery-response.dto.ts` — e o registro de schemas
 * do Swagger é por nome, então uma sobrescrevia a outra no contrato. Na
 * prática, `GET /catalog/discoveries` anunciava um compositor com `imslpId` e
 * sem `fullName`, `portraitUrl` nem `epochName`; quem gerasse cliente a partir
 * do contrato recebia o tipo errado.
 */
class ImslpDiscoveryComposerDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) imslpId: string | null;
}

class DiscoveredWorkDto {
  @ApiProperty() title: string;
  @ApiProperty() imslpUrl: string;

  @ApiProperty({
    description: 'Id numérico da página — o que o catálogo guarda.',
  })
  imslpId: string;

  @ApiProperty({ description: 'Verdadeiro quando a obra já está no catálogo.' })
  alreadyImported: boolean;
}

/**
 * O que o IMSLP anuncia para um compositor e o que já existe aqui. **Só lê** —
 * importar é uma decisão separada, porque a categoria de um compositor grande
 * anuncia mais de mil obras.
 */
export class DiscoveryResultDto {
  @ApiProperty({ type: ImslpDiscoveryComposerDto })
  composer: ImslpDiscoveryComposerDto;

  @ApiProperty() sourceUrl: string;

  @ApiProperty({ description: 'Obras anunciadas na categoria do IMSLP.' })
  found: number;

  @ApiProperty({ description: 'Já casadas por `imslpId` no catálogo.' })
  existing: number;

  @ApiProperty({ type: [DiscoveredWorkDto] })
  works: DiscoveredWorkDto[];

  @ApiProperty({ description: 'Verdadeiro quando a listagem bateu no teto.' })
  truncated: boolean;
}

class ImportOutcomeDto {
  @ApiProperty() imslpUrl: string;
  @ApiProperty() title: string;

  @ApiProperty({ enum: ['imported', 'duplicate', 'failed'] })
  status: string;

  @ApiPropertyOptional({
    description: 'Id da obra criada, ou da que já existia.',
  })
  workId?: string;

  @ApiPropertyOptional({ description: 'Por que aquela obra não entrou.' })
  reason?: string;
}

/** O resultado da importação, obra a obra: uma falha não derruba o lote. */
export class ImportSummaryDto {
  @ApiProperty({ type: ImslpDiscoveryComposerDto })
  composer: ImslpDiscoveryComposerDto;

  @ApiProperty() requested: number;
  @ApiProperty() imported: number;
  @ApiProperty() duplicates: number;
  @ApiProperty() failed: number;

  @ApiProperty({ type: [ImportOutcomeDto] })
  outcomes: ImportOutcomeDto[];
}
