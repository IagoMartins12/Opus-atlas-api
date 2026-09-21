import { ApiProperty } from '@nestjs/swagger';
import { WorkRefDto } from '../../dto/work-ref.dto';

export class WorkFavoriteDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() workId: string;
  @ApiProperty({ type: WorkRefDto }) work: WorkRefDto;
}

export class WorkFavoriteListResponseDto {
  @ApiProperty({ type: [WorkFavoriteDto] }) favorites: WorkFavoriteDto[];
  @ApiProperty() count: number;
}

export class WorkFavoriteStatusResponseDto {
  @ApiProperty() isFavorited: boolean;
  @ApiProperty({ type: WorkFavoriteDto, nullable: true })
  favorite: WorkFavoriteDto | null;
}

export class ToggleWorkFavoriteResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ enum: ['added', 'removed'] }) action: 'added' | 'removed';
  @ApiProperty({ type: WorkFavoriteDto, required: false })
  favorite?: WorkFavoriteDto;
}
