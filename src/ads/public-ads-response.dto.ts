import { ApiProperty } from '@nestjs/swagger';

class PublicAdInstrumentDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Piano' })
  name: string;
}

/** O anúncio como o site o exibe — só o que a tela precisa desenhar. */
export class PublicAdDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true })
  description: string | null;

  @ApiProperty({ nullable: true })
  content: string | null;

  @ApiProperty({ nullable: true })
  imageUrl: string | null;

  @ApiProperty({ nullable: true })
  thumbnailUrl: string | null;

  @ApiProperty({ nullable: true })
  videoUrl: string | null;

  @ApiProperty({ example: 'Saiba mais', nullable: true })
  ctaText: string | null;

  @ApiProperty({ nullable: true })
  targetUrl: string | null;

  @ApiProperty({ nullable: true })
  linkType: string | null;

  @ApiProperty()
  isExternal: boolean;

  @ApiProperty({ example: 'BANNER' })
  type: string;

  @ApiProperty({ example: 'SIDEBAR' })
  placement: string;

  @ApiProperty({ nullable: true })
  targetType: string | null;

  @ApiProperty({ nullable: true })
  targetUserLevel: string | null;

  @ApiProperty({ nullable: true })
  advertiserName: string | null;

  @ApiProperty({ nullable: true })
  advertiserWebsite: string | null;

  @ApiProperty() showOnMobile: boolean;
  @ApiProperty() showOnTablet: boolean;
  @ApiProperty() showOnDesktop: boolean;

  @ApiProperty({ nullable: true })
  instrumentId: string | null;

  @ApiProperty({ type: PublicAdInstrumentDto, nullable: true })
  instrument: PublicAdInstrumentDto | null;
}

export class PublicAdsResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({
    type: [PublicAdDto],
    description: 'Um anúncio por combinação de posição e alvo.',
  })
  ads: PublicAdDto[];

  @ApiProperty({ example: 1 })
  count: number;
}

export class AdEventResultDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({
    description:
      'Falso quando o evento não somou: impressão e clique contam uma vez ' +
      'por pessoa a cada 30 minutos, e sem como identificar quem viu nada é ' +
      'contado.',
  })
  counted: boolean;
}
