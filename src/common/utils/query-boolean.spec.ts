import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsOptional, validate } from 'class-validator';
import { queryBoolean } from './query-boolean';

class FlagQuery {
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  flag?: boolean;
}

// As mesmas opções do ValidationPipe global (main.ts).
async function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(FlagQuery, query, {
    enableImplicitConversion: true,
  });
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return { flag: dto.flag, errors: errors.length };
}

describe('queryBoolean', () => {
  it('"true" e "false" da query viram os booleanos certos', async () => {
    await expect(parse({ flag: 'true' })).resolves.toEqual({
      flag: true,
      errors: 0,
    });
    // Com a conversão implícita, `value` chegaria como `true` aqui.
    await expect(parse({ flag: 'false' })).resolves.toEqual({
      flag: false,
      errors: 0,
    });
  });

  it('booleano de corpo JSON passa como veio', async () => {
    await expect(parse({ flag: false })).resolves.toEqual({
      flag: false,
      errors: 0,
    });
  });

  it('texto que não é booleano é recusado', async () => {
    const { errors } = await parse({ flag: 'talvez' });

    expect(errors).toBe(1);
  });
});
