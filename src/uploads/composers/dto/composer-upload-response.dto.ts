import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ComposerUploadNamedDto {
  @ApiPropertyOptional({ example: '685d591c1e3db0c5aaa893e4' })
  id?: string;

  @ApiProperty({ example: 'Romantismo' })
  name: string;
}

/**
 * O compositor como o cadastro e a edição o devolvem: o registro inteiro, com
 * a época e o papel principal resolvidos — é o que a tela de envio mostra logo
 * depois de salvar.
 */
export class ComposerUploadResponseDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Chopin' })
  name: string;

  @ApiProperty({ example: 'Frédéric François Chopin' })
  fullName: string;

  @ApiProperty({ type: [String], nullable: true })
  alternativeNames: string[] | null;

  @ApiProperty({ example: '1810-03-01', nullable: true })
  birthDate: string | null;

  @ApiProperty({ example: '1849-10-17', nullable: true })
  deathDate: string | null;

  @ApiProperty({ nullable: true })
  portraitUrl: string | null;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  epochId: string;

  @ApiProperty({ nullable: true })
  epochName: string | null;

  @ApiProperty({ nullable: true })
  bio: string | null;

  @ApiProperty({ nullable: true })
  bioEn: string | null;

  @ApiProperty({ nullable: true })
  imslpId: string | null;

  @ApiProperty({ nullable: true })
  permLinkImslp: string | null;

  @ApiProperty({ nullable: true })
  wikipediaLink: string | null;

  @ApiProperty({ nullable: true })
  videoUrl: string | null;

  @ApiProperty({ example: 'Polonês', nullable: true })
  nationality: string | null;

  @ApiProperty({ type: [String], nullable: true })
  instruments: string[] | null;

  @ApiProperty({ type: [String], nullable: true })
  imslpCategories: string[] | null;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  primaryRoleId: string;

  @ApiProperty({ type: [String], nullable: true })
  roles: string[] | null;

  @ApiProperty({ example: 'manual' })
  dataSource: string;

  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4', nullable: true })
  createdBy: string | null;

  @ApiProperty({ description: 'Verdadeiro em cadastro da comunidade.' })
  isCustom: boolean;

  @ApiProperty()
  hasValidImage: boolean;

  @ApiProperty({ nullable: true })
  lastVerified: Date | null;

  @ApiProperty({
    example: 80,
    description: 'Quanto do cadastro está preenchido, de 0 a 100.',
  })
  dataCompleteness: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ type: ComposerUploadNamedDto })
  epoch?: ComposerUploadNamedDto;

  @ApiPropertyOptional({ type: ComposerUploadNamedDto })
  primaryRole?: ComposerUploadNamedDto;
}

class CascadeComposerDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) fullName: string | null;
}

class CascadeWorkDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;

  @ApiProperty({ description: 'Partituras presas a esta obra.' })
  scoresCount: number;
}

class CascadeCountsDto {
  @ApiProperty() works: number;
  @ApiProperty() scores: number;
  @ApiProperty() annotations: number;
  @ApiProperty() favorites: number;

  @ApiProperty({ description: 'Arquivos guardados no armazenamento.' })
  files: number;
}

/**
 * O que a tela de confirmação mostra antes de apagar um compositor: as obras
 * que vão junto, nomeadas (o nome diz mais que o número), e a contagem do
 * resto.
 */
export class ComposerCascadeInfoDto {
  @ApiProperty({ type: CascadeComposerDto })
  composer: CascadeComposerDto;

  @ApiProperty({ type: [CascadeWorkDto] })
  works: CascadeWorkDto[];

  @ApiProperty({ type: CascadeCountsDto })
  willDelete: CascadeCountsDto;
}
