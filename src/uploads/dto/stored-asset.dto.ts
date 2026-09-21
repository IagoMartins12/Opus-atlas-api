import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  StorageAssetKind,
  StorageAssetStatus,
  StorageResourceType,
} from '@prisma/client';

export class StoredAssetDto {
  @ApiProperty({ example: '6700a1b2c3d4e5f60718293a' })
  id: string;

  @ApiProperty({ enum: StorageAssetKind })
  kind: StorageAssetKind;

  @ApiProperty({ enum: StorageAssetStatus })
  status: StorageAssetStatus;

  @ApiProperty({ enum: StorageResourceType })
  resourceType: StorageResourceType;

  @ApiProperty({
    description: 'URL pública e definitiva do arquivo.',
    example:
      'https://res.cloudinary.com/opus/image/upload/v1/opus/production/profiles/abc/profile_image_9f8e.jpg',
    nullable: true,
  })
  url: string | null;

  @ApiPropertyOptional({ example: 'jpg', nullable: true })
  format?: string | null;

  @ApiPropertyOptional({ example: 184320, nullable: true })
  bytes?: number | null;

  @ApiPropertyOptional({ example: 1280, nullable: true })
  width?: number | null;

  @ApiPropertyOptional({ example: 720, nullable: true })
  height?: number | null;

  @ApiPropertyOptional({
    description: 'Duração em segundos, para áudio e vídeo.',
    example: 184.5,
    nullable: true,
  })
  duration?: number | null;

  @ApiProperty({ example: '2026-09-07T18:30:00.000Z' })
  createdAt: Date;
}
