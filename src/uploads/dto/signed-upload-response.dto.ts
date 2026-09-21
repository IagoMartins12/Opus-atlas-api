import { ApiProperty } from '@nestjs/swagger';

export class SignedUploadResponseDto {
  @ApiProperty({
    description:
      'Id do registro do arquivo. Deve ser enviado de volta na confirmação.',
    example: '6700a1b2c3d4e5f60718293a',
  })
  assetId: string;

  @ApiProperty({
    description: 'URL do Cloudinary para onde o navegador envia o arquivo.',
    example: 'https://api.cloudinary.com/v1_1/opus/video/upload',
  })
  uploadUrl: string;

  @ApiProperty({
    description:
      'Campos que devem acompanhar o envio, exatamente como vieram — a assinatura cobre todos eles.',
    example: {
      api_key: '169812345678901',
      timestamp: 1757260800,
      signature: 'a1b2c3d4e5f6',
      folder: 'opus/production/performances/685d591c',
      public_id: 'performance_video_9f8e7d6c',
    },
  })
  fields: Record<string, string | number>;

  @ApiProperty({
    description: 'Limite de tamanho em bytes.',
    example: 524288000,
  })
  maxBytes: number;

  @ApiProperty({
    description:
      'Formatos aceitos. A validação final é feita pelos bytes do arquivo.',
    example: ['video/mp4', 'video/quicktime'],
  })
  allowedMimeTypes: string[];
}
