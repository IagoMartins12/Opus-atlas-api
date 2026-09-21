import { ApiProperty } from '@nestjs/swagger';
import { ComposerRefDto } from '../../dto/composer-ref.dto';

export class ComposerFavoriteDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() composerId: string;
  @ApiProperty({ type: ComposerRefDto }) composer: ComposerRefDto;
}

export class ComposerFavoriteListResponseDto {
  @ApiProperty({ type: [ComposerFavoriteDto] })
  favorites: ComposerFavoriteDto[];
  @ApiProperty() count: number;
}

export class ComposerFavoriteStatusResponseDto {
  @ApiProperty() isFavorited: boolean;
  @ApiProperty({ type: ComposerFavoriteDto, nullable: true })
  favorite: ComposerFavoriteDto | null;
}

export class ToggleComposerFavoriteResponseDto {
  @ApiProperty() success: boolean;
  @ApiProperty({ enum: ['added', 'removed'] }) action: 'added' | 'removed';
  @ApiProperty({ type: ComposerFavoriteDto, required: false })
  favorite?: ComposerFavoriteDto;
}
