/**
 * Compara o `schema.prisma` da API com o do front e imprime as diferenças
 * semânticas (ignorando formatação e comentário).
 *
 * Durante a migração a divergência é deliberada: o front vai deixar de usar
 * Prisma, e a API evolui o schema sozinha. O objetivo aqui não é bloquear, e
 * sim deixar cada diferença registrada no log do CI — para que nenhuma
 * divergência aconteça por acidente, sem ninguém perceber.
 */
const fs = require('fs');
const path = require('path');

const API_SCHEMA = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const FRONT_SCHEMA = path.join(
  __dirname, '..', '..', 'Classical-Music', 'prisma', 'schema.prisma',
);

function normalize(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

if (!fs.existsSync(FRONT_SCHEMA)) {
  console.log('Schema do front não encontrado neste checkout — comparação ignorada.');
  process.exit(0);
}

const api = normalize(API_SCHEMA);
const front = normalize(FRONT_SCHEMA);

const onlyApi = api.filter((line) => !front.includes(line));
const onlyFront = front.filter((line) => !api.includes(line));

if (onlyApi.length === 0 && onlyFront.length === 0) {
  console.log('Os dois schemas estão idênticos.');
  process.exit(0);
}

console.log('Divergências entre o schema da API e o do front:\n');
if (onlyApi.length) {
  console.log('Só na API:');
  onlyApi.forEach((line) => console.log('  + ' + line));
}
if (onlyFront.length) {
  console.log('\nSó no front:');
  onlyFront.forEach((line) => console.log('  - ' + line));
}
console.log(
  '\nDivergência é esperada durante a migração. Confira se cada linha acima é intencional.',
);
