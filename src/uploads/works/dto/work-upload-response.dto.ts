import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A obra como o cadastro e a edição a devolvem: o registro inteiro, com o
 * compositor, a época e o instrumento resolvidos — é o que a tela de envio
 * mostra logo depois de salvar, sem precisar buscar de novo.
 */
class WorkUploadComposerDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Chopin' })
  name: string;

  @ApiProperty({ example: 'Frédéric François Chopin', nullable: true })
  fullName: string | null;

  @ApiPropertyOptional({ nullable: true })
  portraitUrl?: string | null;
}

class WorkUploadNamedDto {
  @ApiPropertyOptional({ example: '685d591c1e3db0c5aaa893e4' })
  id?: string;

  @ApiProperty({ example: 'Piano' })
  name: string;
}

export class WorkUploadResponseDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Sonata No. 2 em Si bemol menor' })
  title: string;

  @ApiProperty({ nullable: true })
  subtitle: string | null;

  @ApiProperty({ example: 'Op. 35', nullable: true })
  opOrCatalog: string | null;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  composerId: string;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  instrumentId: string;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  epochId: string;

  @ApiProperty({ example: 1839, nullable: true })
  compositionYear: number | null;

  @ApiProperty({ nullable: true })
  firstPublishDate: string | null;

  @ApiProperty({ nullable: true })
  tone: string | null;

  @ApiProperty({ nullable: true })
  mediaDuration: string | null;

  @ApiProperty({ nullable: true })
  workStyle: string | null;

  @ApiProperty({ nullable: true })
  moviment: string | null;

  @ApiProperty({ nullable: true })
  dedicateTo: string | null;

  @ApiProperty({ nullable: true })
  instrumentation: string | null;

  @ApiProperty({ nullable: true })
  videoUrl: string | null;

  @ApiProperty({ example: 'INDIVIDUAL' })
  workType: string;

  @ApiProperty({ nullable: true })
  movementNumber: number | null;

  @ApiProperty({ nullable: true })
  parentWorkId: string | null;

  @ApiProperty({ type: [String] })
  categoryNames: string[];

  @ApiProperty({ type: [String] })
  workGenresArr: string[];

  @ApiProperty({ type: [String] })
  imslpTags: string[];

  @ApiProperty({ description: 'Vazio em obra cadastrada à mão.' })
  imslpPermlink: string;

  @ApiProperty({ description: 'Vazio em obra cadastrada à mão.' })
  imslpId: string;

  @ApiProperty({ nullable: true })
  spotifyTrackId: string | null;

  @ApiProperty({ nullable: true })
  youtubeVideoId: string | null;

  @ApiProperty({ nullable: true })
  customAudioUrl: string | null;

  @ApiProperty({ nullable: true })
  videoAulaUrl: string | null;

  @ApiProperty({ nullable: true })
  mediaSource: string | null;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4', nullable: true })
  createdBy: string | null;

  @ApiProperty({ description: 'Verdadeiro em obra enviada pela comunidade.' })
  isCustom: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ type: WorkUploadComposerDto })
  composer?: WorkUploadComposerDto;

  @ApiPropertyOptional({ type: WorkUploadNamedDto })
  epoch?: WorkUploadNamedDto;

  @ApiPropertyOptional({ type: WorkUploadNamedDto })
  instrument?: WorkUploadNamedDto;
}

class CascadeScoreDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ example: 'IMSLP' }) source: string;
}

class CascadeCountsDto {
  @ApiProperty() scores: number;
  @ApiProperty() annotations: number;
  @ApiProperty() favorites: number;
  @ApiProperty() wantToLearn: number;
  @ApiProperty() learned: number;

  @ApiProperty({ description: 'Arquivos guardados no armazenamento.' })
  files: number;
}

class CascadeWorkDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
}

/**
 * O que a tela de confirmação precisa mostrar antes de apagar: a obra, as
 * partituras que vão junto (nomeadas, porque podem ser de outra pessoa) e a
 * contagem do resto.
 */
export class WorkCascadeInfoDto {
  @ApiProperty({ type: CascadeWorkDto })
  work: CascadeWorkDto;

  @ApiProperty({ type: [CascadeScoreDto] })
  scores: CascadeScoreDto[];

  @ApiProperty({ type: CascadeCountsDto })
  willDelete: CascadeCountsDto;
}
