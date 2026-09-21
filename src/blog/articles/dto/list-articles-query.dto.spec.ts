import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListArticlesQueryDto } from './list-articles-query.dto';

// As mesmas opções do ValidationPipe global (main.ts): a query chega como
// texto e passa pela conversão implícita antes dos `@Transform`.
function parse(query: Record<string, string>) {
  const dto = plainToInstance(ListArticlesQueryDto, query, {
    enableImplicitConversion: true,
  });

  return validate(dto, { whitelist: true, forbidNonWhitelisted: true }).then(
    (errors) => ({ dto, errors }),
  );
}

describe('ListArticlesQueryDto — featured', () => {
  // O carrossel da home pede `featured=true`; o filtro virava `false` e a
  // lista vinha só com os que não são destaque.
  it('"true" vira verdadeiro', async () => {
    const { dto, errors } = await parse({ featured: 'true' });

    expect(errors).toEqual([]);
    expect(dto.featured).toBe(true);
  });

  it('"false" vira falso', async () => {
    const { dto, errors } = await parse({ featured: 'false' });

    expect(errors).toEqual([]);
    expect(dto.featured).toBe(false);
  });

  it('sem o parâmetro, não filtra', async () => {
    const { dto, errors } = await parse({});

    expect(errors).toEqual([]);
    expect(dto.featured).toBeUndefined();
  });
});
