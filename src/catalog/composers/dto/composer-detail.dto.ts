import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ComposerDetailEpochDto {
  @ApiProperty({ example: 'Romântico' })
  name: string;
}

export class ComposerDetailDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Beethoven' })
  name: string;

  @ApiProperty({ example: 'Ludwig van Beethoven' })
  fullName: string;

  @ApiPropertyOptional({ nullable: true })
  videoUrl?: string;

  @ApiPropertyOptional({ nullable: true })
  alternativeNames?: string;

  @ApiPropertyOptional({ nullable: true })
  birthDate?: string;

  @ApiPropertyOptional({ nullable: true })
  deathDate?: string;

  @ApiPropertyOptional({ nullable: true })
  portraitUrl?: string;

  @ApiPropertyOptional({ nullable: true })
  bio?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Biografia em inglês (antes num JSON em disco do front)',
  })
  bioEn?: string;

  @ApiProperty({
    description:
      'A biografia em português foi gerada por IA e ninguém a revisou — o front pode avisar',
  })
  bioGeneratedByAi: boolean;

  @ApiPropertyOptional({ nullable: true })
  permLinkImslp?: string;

  @ApiPropertyOptional({ nullable: true })
  wikipediaLink?: string;

  @ApiProperty({ example: '685d59f31e3db0c5aaa89439' })
  epochId: string;

  @ApiProperty({ example: 'Romântico' })
  epochName: string;

  @ApiPropertyOptional({ nullable: true })
  primaryRoleId?: string;

  @ApiPropertyOptional({ nullable: true })
  primaryRoleName?: string;

  @ApiProperty({ example: 322 })
  worksCount: number;

  @ApiProperty({ example: '2026-09-06T12:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ type: [String], required: false })
  roleNames?: string[];

  @ApiProperty({ example: false })
  isVerified: boolean;

  @ApiPropertyOptional({ nullable: true })
  verificationStatus?: string;

  @ApiPropertyOptional({ nullable: true })
  verifiedBy?: string;

  @ApiPropertyOptional({ example: '2026-09-06T12:00:00.000Z', nullable: true })
  verifiedAt?: Date;

  @ApiPropertyOptional({ nullable: true })
  verificationNotes?: string;

  @ApiPropertyOptional({ nullable: true })
  nationality?: string;

  @ApiPropertyOptional({ nullable: true })
  instruments?: string;

  @ApiPropertyOptional({ nullable: true })
  imslpCategories?: string;

  @ApiPropertyOptional({ nullable: true })
  pageQuality?: string;

  @ApiPropertyOptional({ example: '2026-09-06T12:00:00.000Z', nullable: true })
  lastVerified?: Date;

  @ApiPropertyOptional({ example: 91.5, nullable: true })
  dataCompleteness?: number;

  @ApiProperty({ example: true })
  hasValidImage: boolean;

  @ApiPropertyOptional({ type: ComposerDetailEpochDto, nullable: true })
  epoch?: ComposerDetailEpochDto | null;
}
