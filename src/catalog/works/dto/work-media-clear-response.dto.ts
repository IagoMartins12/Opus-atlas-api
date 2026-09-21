import { ApiProperty } from '@nestjs/swagger';

/** O que a limpeza de mídia apagou da obra. */
export class ClearWorkMediaResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({
    type: [String],
    example: ['spotifyTrackId', 'spotifyTrackUrl'],
    description:
      'Campos zerados. Quando o arquivo era hospedado aqui, ele também sai ' +
      'do armazenamento.',
  })
  clearedFields: string[];
}

/** O resultado de reler as partituras da obra no IMSLP. */
export class RefreshWorkScoresResponseDto {
  @ApiProperty({ description: 'Partituras que não existiam aqui.' })
  created: number;

  @ApiProperty({
    description: 'Partituras que já existiam e foram atualizadas.',
  })
  updated: number;

  @ApiProperty({ description: 'Quantas a página do IMSLP tinha.' })
  total: number;
}
