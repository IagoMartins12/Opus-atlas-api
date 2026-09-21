import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Um compositor, obra ou partitura que a pessoa criou — o `UserUpload` do front. */
export class MyUploadItemDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: ['composer', 'work', 'score'] })
  type: 'composer' | 'work' | 'score';
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
  @ApiProperty() isIMSLP: boolean;
  @ApiPropertyOptional() imslpId?: string;
  @ApiPropertyOptional() imslpPermlink?: string;
  @ApiPropertyOptional() epochName?: string;
  @ApiPropertyOptional() composerName?: string;
  @ApiPropertyOptional() composerId?: string;
  @ApiPropertyOptional() instrumentName?: string;
  @ApiPropertyOptional({ type: [String] }) workGenres?: string[];
  @ApiPropertyOptional({ type: [String] }) categoryNames?: string[];
  @ApiPropertyOptional() verificationStatus?: string;
  @ApiPropertyOptional() pageCount?: string;
  @ApiPropertyOptional() fileSize?: string;
  @ApiPropertyOptional() dataQuality?: string;
  @ApiPropertyOptional() portraitUrl?: string;
  @ApiPropertyOptional() workTitle?: string;
  @ApiPropertyOptional() workId?: string;
  @ApiPropertyOptional() downloadUrl?: string;
}

export class MyUploadsResponseDto {
  @ApiProperty({ type: [MyUploadItemDto] })
  items: MyUploadItemDto[];

  @ApiProperty({ description: 'Soma das três contagens, com os filtros' })
  totalCount: number;

  @ApiProperty() composerCount: number;
  @ApiProperty() workCount: number;
  @ApiProperty() scoreCount: number;

  @ApiProperty({ description: 'Há mais de 16 compositores (limite por tipo)' })
  hasMoreComposers: boolean;

  @ApiProperty() hasMoreWorks: boolean;
  @ApiProperty() hasMoreScores: boolean;
}
