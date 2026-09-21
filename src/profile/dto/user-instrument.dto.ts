import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DifficultyLevel } from '@prisma/client';
import { IsBoolean, IsEnum, IsMongoId } from 'class-validator';

/** Um instrumento na lista de `PATCH /profile` (a lista substitui a anterior). */
export class UserInstrumentInputDto {
  @ApiProperty() @IsMongoId() instrumentId: string;
  @ApiProperty({ enum: DifficultyLevel })
  @IsEnum(DifficultyLevel)
  level: DifficultyLevel;
  @ApiProperty() @IsBoolean() isPrimary: boolean;
  @ApiProperty() @IsBoolean() isLearning: boolean;
}

export class UserInstrumentDto {
  @ApiProperty() id: string;
  @ApiProperty() instrumentId: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) category?: string | null;
  @ApiProperty({ enum: DifficultyLevel }) level: DifficultyLevel;
  @ApiProperty() isPrimary: boolean;
  @ApiProperty() isLearning: boolean;
  @ApiProperty() startedAt: Date;
}
