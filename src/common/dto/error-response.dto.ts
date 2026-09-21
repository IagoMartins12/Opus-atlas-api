import { ApiProperty } from '@nestjs/swagger';

/**
 * Formato padrão de resposta de erro em toda a API.
 * Documentado no Swagger para todo endpoint que possa falhar (todos).
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode: number;

  @ApiProperty({ example: 'Not Found' })
  error: string;

  @ApiProperty({
    example: 'Obra não encontrada',
    description:
      'Mensagem legível para exibição ou log. Pode ser um array em erros de validação.',
  })
  message: string | string[];

  @ApiProperty({ example: '/works/abc123' })
  path: string;

  @ApiProperty({ example: '2026-09-06T12:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'a1b2c3d4', required: false })
  requestId?: string;
}
