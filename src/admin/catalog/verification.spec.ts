import { verificationChange, verificationCore } from './verification';

describe('verificationChange', () => {
  it('verificar registra quem e quando', () => {
    const result = verificationChange(true, 'admin-1', 'Conferido no IMSLP');

    expect(result.isVerified).toBe(true);
    expect(result.verifiedBy).toBe('admin-1');
    expect(result.verifiedAt).toBeInstanceOf(Date);
    expect(result.verificationNotes).toBe('Conferido no IMSLP');
  });

  // No legado os três campos só eram escritos no ramo `if (isVerified)`: ao
  // desmarcar, o registro ficava não verificado e "verificado por Fulano" ao
  // mesmo tempo.
  it('desverificar limpa a atribuição', () => {
    const result = verificationChange(false, 'admin-1');

    expect(result.isVerified).toBe(false);
    expect(result.verifiedBy).toBeNull();
    expect(result.verifiedAt).toBeNull();
  });

  // A justificativa de por que a verificação foi retirada é justamente a que
  // mais importa registrar — e era descartada.
  it('a nota é gravada também ao retirar a verificação', () => {
    const result = verificationChange(false, 'admin-1', 'Datas divergentes');

    expect(result.verificationNotes).toBe('Datas divergentes');
  });

  it('sem nota, grava nulo em vez de indefinido', () => {
    expect(verificationChange(true, 'admin-1').verificationNotes).toBeNull();
  });

  // `verificationStatus` existe em `Composer` e em `Work`, é lido pela rota
  // pública de detalhe, e o caminho administrativo só escrevia `isVerified`.
  // Dois campos sobre o mesmo fato, um atualizado e o outro não.
  it('escreve `verificationStatus` junto de `isVerified`', () => {
    expect(verificationChange(true, 'admin-1').verificationStatus).toBe(
      'verified',
    );
    expect(verificationChange(false, 'admin-1').verificationStatus).toBe(
      'pending',
    );
  });
});

describe('verificationCore', () => {
  // `Work` não tem `verificationNotes`; escrever o campo quebraria a escrita.
  it('não inclui a nota, que só existe em compositor', () => {
    expect(verificationCore(true, 'admin-1')).not.toHaveProperty(
      'verificationNotes',
    );
  });

  it('mantém as mesmas garantias do núcleo', () => {
    const retirada = verificationCore(false, 'admin-1');

    expect(retirada.isVerified).toBe(false);
    expect(retirada.verificationStatus).toBe('pending');
    expect(retirada.verifiedBy).toBeNull();
    expect(retirada.verifiedAt).toBeNull();
  });
});
