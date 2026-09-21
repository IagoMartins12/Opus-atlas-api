import { Prisma } from '@prisma/client';
import {
  buildSelect,
  describeFields,
  isSecretField,
  readableFields,
} from './field-policy';

const modelNamed = (name: string): Prisma.DMMF.Model => {
  const model = Prisma.dmmf.datamodel.models.find(
    (entry) => entry.name === name,
  );

  if (!model) {
    throw new Error(`Model ${name} não existe no schema`);
  }

  return model;
};

describe('isSecretField', () => {
  it('protege por padrão de nome, não por lista', () => {
    expect(isSecretField('hashedPassword')).toBe(true);
    expect(isSecretField('sessionToken')).toBe(true);
    expect(isSecretField('access_token')).toBe(true);
    expect(isSecretField('algumCampoNovoComToken')).toBe(true);
  });

  it('deixa passar o que não casa', () => {
    expect(isSecretField('email')).toBe(false);
    expect(isSecretField('title')).toBe(false);
  });
});

describe('describeFields', () => {
  // A lista do legado cobria três models e não incluía este campo — que é o
  // token de reset de senha e de confirmação de e-mail.
  it('protege `UserToken.token`, que a lista do legado não cobria', () => {
    const fields = describeFields(modelNamed('UserToken'));
    const token = fields.find((field) => field.name === 'token');

    expect(token?.isSecret).toBe(true);
  });

  it('protege os tokens da newsletter', () => {
    const fields = describeFields(modelNamed('NewsletterSubscriber'));

    expect(
      fields.find((field) => field.name === 'confirmationToken')?.isSecret,
    ).toBe(true);
    expect(
      fields.find((field) => field.name === 'unsubscribeToken')?.isSecret,
    ).toBe(true);
  });

  it('protege o hash de senha do usuário', () => {
    const fields = describeFields(modelNamed('User'));

    expect(
      fields.find((field) => field.name === 'hashedPassword')?.isSecret,
    ).toBe(true);
  });

  // `User.tokens` casa com o padrão por acidente do nome, mas é relação.
  it('não inclui relações', () => {
    const fields = describeFields(modelNamed('User'));

    expect(fields.find((field) => field.name === 'tokens')).toBeUndefined();
  });

  it('marca o identificador', () => {
    const fields = describeFields(modelNamed('Work'));

    expect(fields.find((field) => field.isId)?.name).toBe('id');
  });
});

describe('buildSelect', () => {
  const fields = describeFields(modelNamed('User'));

  // Era este `undefined` que fazia o legado devolver o documento inteiro.
  it('nunca devolve indefinido — sem campos pedidos, seleciona os legíveis', () => {
    const select = buildSelect(fields);

    expect(Object.keys(select).length).toBe(readableFields(fields).length);
    expect(select).not.toHaveProperty('hashedPassword');
  });

  it('descarta campo protegido pedido explicitamente', () => {
    const select = buildSelect(fields, ['id', 'email', 'hashedPassword']);

    expect(select).toEqual({ id: true, email: true });
  });

  it('descarta campo inexistente', () => {
    const select = buildSelect(fields, ['email', 'campoQueNaoExiste']);

    expect(select).not.toHaveProperty('campoQueNaoExiste');
  });

  // Sem id a linha não é endereçável para editar nem apagar.
  it('sempre inclui o identificador', () => {
    expect(buildSelect(fields, ['email'])).toHaveProperty('id', true);
  });
});
