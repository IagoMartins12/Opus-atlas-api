import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ExportRecordsQueryDto,
  ListRecordsQueryDto,
} from './admin-database.dto';

// Mesmas opções da ValidationPipe global.
const check = async (
  target: typeof ListRecordsQueryDto | typeof ExportRecordsQueryDto,
  query: Record<string, unknown>,
) => {
  const dto = plainToInstance(target, query);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors };
};

describe('filtros da leitura do banco', () => {
  // O `@Transform` do JSON passava por cima do `@Type`: cada filtro chegava
  // como objeto comum, e o `forbidNonWhitelisted` recusava field, operator e
  // value — nenhum filtro funcionava.
  it('aceita a lista de filtros em JSON, como vem na query', async () => {
    const { dto, errors } = await check(ListRecordsQueryDto, {
      model: 'Epoch',
      filters: JSON.stringify([
        { field: 'name', operator: 'contains', value: 'o' },
      ]),
    });

    expect(errors).toEqual([]);
    expect(dto.filters?.[0]).toMatchObject({
      field: 'name',
      operator: 'contains',
      value: 'o',
    });
  });

  it('vale também para a exportação', async () => {
    const { errors } = await check(ExportRecordsQueryDto, {
      model: 'Epoch',
      format: 'csv',
      filters: JSON.stringify([{ field: 'name', operator: 'eq', value: 'x' }]),
    });

    expect(errors).toEqual([]);
  });

  it('recusa operador fora da gramática', async () => {
    const { errors } = await check(ListRecordsQueryDto, {
      model: 'Epoch',
      filters: JSON.stringify([
        { field: 'name', operator: 'regex', value: '.*' },
      ]),
    });

    expect(errors).not.toEqual([]);
  });

  it('recusa campo a mais dentro do filtro', async () => {
    const { errors } = await check(ListRecordsQueryDto, {
      model: 'Epoch',
      filters: JSON.stringify([
        { field: 'name', operator: 'eq', value: 'x', raw: { $where: '1' } },
      ]),
    });

    expect(errors).not.toEqual([]);
  });

  it('JSON malformado é erro de validação, não 500', async () => {
    const { errors } = await check(ListRecordsQueryDto, {
      model: 'Epoch',
      filters: '[{',
    });

    expect(errors).not.toEqual([]);
  });
});
