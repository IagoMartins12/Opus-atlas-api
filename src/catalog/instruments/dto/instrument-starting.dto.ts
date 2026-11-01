import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StartingPieceDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ nullable: true }) popularName: string | null;
  @ApiPropertyOptional({ nullable: true }) popularNameEn: string | null;
  @ApiProperty() composer: string;
  @ApiProperty() why: string;
  @ApiProperty() whyEn: string;
}

export class StartingLevelDto {
  @ApiProperty({ enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] })
  tier: string;

  @ApiProperty({ type: [StartingPieceDto] })
  pieces: StartingPieceDto[];
}
