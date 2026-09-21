import { ApiProperty } from '@nestjs/swagger';

export class AvatarResponseDto {
  @ApiProperty({
    description: 'URL definitiva da nova foto de perfil.',
    example:
      'https://res.cloudinary.com/opus/image/upload/v1/opus/production/profiles/665f/profile_image_9f8e.jpg',
  })
  imageUrl: string;
}
