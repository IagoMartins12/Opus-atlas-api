import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class WorkAudioInfoDto {
  @ApiProperty({ example: true })
  hasCustomAudio: boolean;

  @ApiPropertyOptional({ nullable: true })
  audioSource?: string | null;

  @ApiPropertyOptional({ nullable: true })
  audioUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  audioFile?: string | null;
}

export class WorkMediaResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({
    type: [String],
    example: ['spotifyTrackId', 'spotifyTrackUrl'],
  })
  updatedFields: string[];

  @ApiProperty({ type: WorkAudioInfoDto })
  audioInfo: WorkAudioInfoDto;
}
