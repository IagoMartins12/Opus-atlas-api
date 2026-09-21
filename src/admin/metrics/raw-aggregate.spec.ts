import { toObjectId } from './raw-aggregate';

describe('toObjectId', () => {
  // `$runCommandRaw` devolve JSON estendido do MongoDB: um `ObjectId` chega
  // como `{ "$oid": "..." }`, e não como o texto que o Prisma usa nas demais
  // consultas.
  it('extrai o id do formato estendido', () => {
    expect(toObjectId({ $oid: '685e1087c6bd886c5b495d66' })).toBe(
      '685e1087c6bd886c5b495d66',
    );
  });

  it('deixa passar o que já é texto', () => {
    expect(toObjectId('685e1087c6bd886c5b495d66')).toBe(
      '685e1087c6bd886c5b495d66',
    );
  });

  // Passar o objeto adiante faria a consulta falhar; num campo de texto, pior:
  // não falharia, só não encontraria nada.
  it('devolve nulo para o que não reconhece', () => {
    expect(toObjectId(null)).toBeNull();
    expect(toObjectId(undefined)).toBeNull();
    expect(toObjectId(42)).toBeNull();
    expect(toObjectId({ oid: 'sem cifrão' })).toBeNull();
    expect(toObjectId({ $oid: 123 })).toBeNull();
  });
});
