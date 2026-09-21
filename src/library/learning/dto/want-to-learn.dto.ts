import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DifficultyLevel } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { WorkRefWithInstrumentDto } from '../../dto/work-ref.dto';
import { WorkScoreRefDto } from '../../dto/work-score-ref.dto';

export class AddWantToLearnDto {
  @ApiProperty() @IsMongoId() workId: string;

  @ApiProperty({ enum: ['add', 'remove'] })
  @IsIn(['add', 'remove'])
  action: 'add' | 'remove';

  @ApiPropertyOptional({ minimum: 0, maximum: 5, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  priority?: number = 0;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() targetDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() estimatedStudyTime?: number;
  @ApiPropertyOptional({ enum: DifficultyLevel })
  @IsOptional()
  @IsEnum(DifficultyLevel)
  difficulty?: DifficultyLevel;
  @ApiPropertyOptional() @IsOptional() @IsString() motivation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() context?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  selectedWorkScoreId?: string;

  @ApiPropertyOptional({
    description:
      'Milestones de progresso específicos do instrumento (formato livre)',
  })
  @IsOptional()
  @IsObject()
  progressMilestones?: Record<string, unknown>;
}

export class UpdateWantToLearnDto {
  @ApiProperty() @IsMongoId() workId: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  priority?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() targetDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() estimatedStudyTime?: number;
  @ApiPropertyOptional({ enum: DifficultyLevel })
  @IsOptional()
  @IsEnum(DifficultyLevel)
  difficulty?: DifficultyLevel;
  @ApiPropertyOptional() @IsOptional() @IsString() motivation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() context?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  selectedWorkScoreId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  progressMilestones?: Record<string, unknown>;
}

export class WantToLearnItemDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() workId: string;
  @ApiProperty() priority: number;
  @ApiProperty() addedAt: Date;
  @ApiPropertyOptional({ nullable: true }) notes?: string | null;
  @ApiPropertyOptional({ nullable: true }) targetDate?: Date | null;
  @ApiPropertyOptional({ nullable: true }) estimatedStudyTime?: number | null;
  @ApiPropertyOptional({ nullable: true, enum: DifficultyLevel })
  difficulty?: DifficultyLevel | null;
  @ApiPropertyOptional({ nullable: true }) motivation?: string | null;
  @ApiPropertyOptional({ nullable: true }) context?: string | null;
  @ApiPropertyOptional({ nullable: true }) selectedWorkScoreId?: string | null;
  @ApiPropertyOptional({ type: WorkScoreRefDto, nullable: true })
  selectedWorkScore?: WorkScoreRefDto | null;
  @ApiPropertyOptional({ nullable: true }) progressMilestones?: unknown;
  @ApiPropertyOptional({ nullable: true }) progress?: number | null;
  @ApiProperty({ type: WorkRefWithInstrumentDto })
  work: WorkRefWithInstrumentDto;
}

export class WantToLearnListResponseDto {
  @ApiProperty({ type: [WantToLearnItemDto] }) items: WantToLearnItemDto[];
  @ApiProperty() count: number;
}

export class WantToLearnStatusResponseDto {
  @ApiProperty() wantToLearn: boolean;
  @ApiProperty({ type: WantToLearnItemDto, nullable: true })
  item: WantToLearnItemDto | null;
}

export class WantToLearnActionResponseDto {
  @ApiProperty() success: boolean;
  @ApiPropertyOptional({ enum: ['added', 'removed'] }) action?:
    | 'added'
    | 'removed';
  @ApiPropertyOptional({ type: WantToLearnItemDto }) item?: WantToLearnItemDto;
}
