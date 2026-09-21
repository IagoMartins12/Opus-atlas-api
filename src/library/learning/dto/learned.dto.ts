import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DifficultyLevel } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { WorkRefDto } from '../../dto/work-ref.dto';
import { WorkScoreRefDto } from '../../dto/work-score-ref.dto';

const VIDEO_ASSET_DESCRIPTION =
  'Vídeo de performance: o `assetId` de `POST /uploads/signed` ' +
  '(`kind=PERFORMANCE_VIDEO`, `scopeId` = a obra), já confirmado. Substitui o ' +
  'envio multipart do legado, que gravava o vídeo no disco do servidor.';

export class AddLearnedDto {
  @ApiProperty() @IsMongoId() workId: string;

  @ApiProperty({ enum: ['add', 'remove'] })
  @IsIn(['add', 'remove'])
  action: 'add' | 'remove';

  @ApiPropertyOptional({ minimum: 0, maximum: 5, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  mastery?: number = 0;

  @ApiPropertyOptional() @IsOptional() @IsDateString() studyStartDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() studyDuration?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() wouldRecommend?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() publicPerformance?: boolean;
  @ApiPropertyOptional({ enum: DifficultyLevel })
  @IsOptional()
  @IsEnum(DifficultyLevel)
  difficulty?: DifficultyLevel;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  enjoyment?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() technicalChallenges?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() musicalInsights?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  selectedWorkScoreId?: string;

  @ApiPropertyOptional({ description: VIDEO_ASSET_DESCRIPTION })
  @IsOptional()
  @IsMongoId()
  videoAssetId?: string;

  @ApiPropertyOptional({ description: 'Nome original do vídeo, para exibir.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  videoFileName?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isVideoPublic?: boolean;
}

export class UpdateLearnedDto {
  @ApiProperty() @IsMongoId() workId: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  mastery?: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString() studyStartDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() studyDuration?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() wouldRecommend?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() publicPerformance?: boolean;
  @ApiPropertyOptional({ enum: DifficultyLevel })
  @IsOptional()
  @IsEnum(DifficultyLevel)
  difficulty?: DifficultyLevel;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  enjoyment?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() technicalChallenges?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() musicalInsights?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  selectedWorkScoreId?: string;

  @ApiPropertyOptional({ description: VIDEO_ASSET_DESCRIPTION })
  @IsOptional()
  @IsMongoId()
  videoAssetId?: string;

  @ApiPropertyOptional({ description: 'Nome original do vídeo, para exibir.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  videoFileName?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isVideoPublic?: boolean;

  @ApiPropertyOptional({
    description: 'Tira o vídeo do item e apaga o arquivo do armazenamento.',
  })
  @IsOptional()
  @IsBoolean()
  removeVideo?: boolean;
}

export class LearnedItemDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() workId: string;
  @ApiProperty() mastery: number;
  @ApiProperty() learnedAt: Date;
  @ApiPropertyOptional({ nullable: true }) studyStartDate?: Date | null;
  @ApiPropertyOptional({ nullable: true }) studyDuration?: number | null;
  @ApiPropertyOptional({ nullable: true }) notes?: string | null;
  @ApiProperty() wouldRecommend: boolean;
  @ApiProperty() publicPerformance: boolean;
  @ApiPropertyOptional({ nullable: true, enum: DifficultyLevel })
  difficulty?: DifficultyLevel | null;
  @ApiPropertyOptional({ nullable: true }) enjoyment?: number | null;
  @ApiPropertyOptional({ nullable: true }) technicalChallenges?: string | null;
  @ApiPropertyOptional({ nullable: true }) musicalInsights?: string | null;
  @ApiPropertyOptional({ nullable: true }) selectedWorkScoreId?: string | null;
  @ApiPropertyOptional({ type: WorkScoreRefDto, nullable: true })
  selectedWorkScore?: WorkScoreRefDto | null;
  @ApiPropertyOptional({ nullable: true }) videoUrl?: string | null;
  @ApiPropertyOptional({ nullable: true }) videoFileName?: string | null;
  @ApiPropertyOptional({ nullable: true }) videoFileSize?: number | null;
  @ApiPropertyOptional({ nullable: true }) videoUploadedAt?: Date | null;
  @ApiProperty() isVideoPublic: boolean;
  @ApiProperty({ type: WorkRefDto }) work: WorkRefDto;
}

export class LearnedListResponseDto {
  @ApiProperty({ type: [LearnedItemDto] }) items: LearnedItemDto[];
  @ApiProperty() count: number;
}

export class LearnedStatusResponseDto {
  @ApiProperty() learned: boolean;
  @ApiProperty({ type: LearnedItemDto, nullable: true })
  item: LearnedItemDto | null;
}

export class LearnedActionResponseDto {
  @ApiProperty() success: boolean;
  @ApiPropertyOptional({ enum: ['added', 'removed'] }) action?:
    | 'added'
    | 'removed';
  @ApiPropertyOptional({ type: LearnedItemDto }) item?: LearnedItemDto;
}
