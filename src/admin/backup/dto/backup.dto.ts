import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class BackupCollectionDto {
  @ApiProperty({ example: 'Work', description: 'Nome da coleção no banco.' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    example: 1000,
    nullable: true,
    description:
      'Quantos documentos guardar desta coleção. Ausente ou nulo é "tudo".',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number | null;
}

export class UpdateBackupSettingsDto {
  @ApiProperty({
    example: 3,
    minimum: 1,
    maximum: 30,
    description:
      'Quantos arquivos manter no bucket. O mais antigo sai quando um novo ' +
      'entra — e só depois de o novo passar na verificação.',
  })
  @IsInt()
  @Min(1)
  @Max(30)
  keep!: number;

  @ApiProperty({
    type: [BackupCollectionDto],
    description:
      'As coleções que entram no backup. Fora daqui, fora do arquivo.',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BackupCollectionDto)
  collections!: BackupCollectionDto[];
}

export class BackupAvailableCollectionDto {
  @ApiProperty({ example: 'blog_articles' })
  name!: string;

  @ApiProperty({ example: 'BlogArticle' })
  model!: string;

  @ApiProperty({ example: 207892 })
  documents!: number;
}

export class BackupSettingsResponseDto {
  @ApiProperty({ example: 3 })
  keep!: number;

  @ApiProperty({ type: [BackupCollectionDto] })
  collections!: BackupCollectionDto[];

  @ApiPropertyOptional({
    nullable: true,
    example:
      'Armazenamento de backup não configurado. Falta: BACKUP_R2_BUCKET.',
    description:
      'O que impede o backup de rodar, quando impede. Nulo quando está tudo no lugar.',
  })
  storageIssue!: string | null;
}

export class BackupFileDto {
  @ApiProperty({ example: 'backups/backup-2026-09-21.json.gz' })
  key!: string;

  @ApiProperty({ example: 18234567 })
  sizeBytes!: number;

  @ApiProperty({ example: '2026-09-21T03:00:00.000Z' })
  createdAt!: string;
}

export class BackupRunDto {
  @ApiProperty({ example: '68d0a1c21e3db0c5aaa89512' })
  id!: string;

  @ApiProperty({ example: '2026-09-21T03:00:00.000Z' })
  startedAt!: string;

  @ApiPropertyOptional({ nullable: true })
  finishedAt!: string | null;

  @ApiProperty({ example: 'ok', enum: ['running', 'ok', 'failed'] })
  status!: string;

  @ApiPropertyOptional({ nullable: true })
  objectKey!: string | null;

  @ApiPropertyOptional({ nullable: true })
  sizeBytes!: number | null;

  @ApiPropertyOptional({ nullable: true })
  documentCount!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Quando o arquivo foi baixado de volta e lido com sucesso.',
  })
  verifiedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  error!: string | null;

  @ApiProperty({ type: [BackupCollectionDto], required: false })
  collections?: Array<{ name: string; documents: number }>;

  @ApiProperty({ type: [String], required: false })
  rotated?: string[];
}

export class BackupDownloadDto {
  @ApiProperty({ description: 'Link assinado, válido por uma hora.' })
  url!: string;

  @ApiProperty({ example: 3600 })
  expiresInSeconds!: number;
}
