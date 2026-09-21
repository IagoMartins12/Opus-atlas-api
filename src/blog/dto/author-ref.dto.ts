import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthorRefDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({ nullable: true }) firstName?: string | null;
  @ApiPropertyOptional({ nullable: true }) lastName?: string | null;
  @ApiPropertyOptional({ nullable: true }) username?: string | null;
  @ApiPropertyOptional({ nullable: true }) image?: string | null;
}

export class AuthorRefWithBioDto extends AuthorRefDto {
  @ApiPropertyOptional({ nullable: true }) bio?: string | null;
}

export const AUTHOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  image: true,
} as const;

export const AUTHOR_SELECT_WITH_BIO = {
  ...AUTHOR_SELECT,
  bio: true,
} as const;
