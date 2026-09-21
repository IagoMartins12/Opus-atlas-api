/**
 * Sobe a aplicação Nest inteira e encerra em seguida.
 *
 * O `tsc` valida tipos, mas não enxerga o grafo de injeção de dependência do
 * Nest: um provider esquecido num módulo compila normalmente e só quebra ao
 * subir. Este passo transforma esse erro em falha de CI.
 *
 * Nada de rede é exigido: o boot é abortado antes de `listen()`.
 */
const path = require('path');

async function main() {
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(path.join(__dirname, '..', 'dist', 'app.module'));

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
    rawBody: true,
  });

  await app.init();
  await app.close();

  console.log('OK: o grafo de módulos do Nest resolveu sem erro.');

  // Saída explícita: conexões com Redis e MongoDB deixam handles abertos que
  // manteriam o processo vivo depois do `close()`, travando o job do CI.
  process.exit(0);
}

main().catch((error) => {
  console.error('FALHA ao inicializar a aplicação:');
  console.error(error);
  process.exit(1);
});
