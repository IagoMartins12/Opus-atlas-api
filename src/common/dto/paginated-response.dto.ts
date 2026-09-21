import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';

/**
 * Envelope padrão de resposta paginada. Use `ApiExtraModels` + `getSchemaPath`
 * no controller para documentar corretamente o tipo genérico `T` no Swagger
 * (ver exemplo de uso em `works.controller.ts`).
 */
export class PaginatedResponseDto<T> {
  // `T` não existe em tempo de execução: o plugin do Swagger não tem o que
  // documentar aqui, e cada controller declara `data` com o tipo concreto.
  @ApiHideProperty()
  data: T[];

  @ApiProperty({ example: 132 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 7 })
  totalPages: number;
}
