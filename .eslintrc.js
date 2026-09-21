module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist', 'coverage', 'scripts/*.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',

    // `any` desliga o compilador justamente onde o risco é maior. O código de
    // produção está 100% tipado hoje; a regra existe para não regredir.
    // Onde o tipo é genuinamente desconhecido, use `unknown` e estreite.
    '@typescript-eslint/no-explicit-any': 'error',

    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        // `_` como prefixo marca parâmetro exigido pela assinatura e não usado.
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        // Permite `const { senha, ...resto } = dto` para omitir um campo.
        ignoreRestSiblings: true,
      },
    ],
  },
  overrides: [
    {
      // Mocks de teste descrevem só a fatia do Prisma que o caso usa; exigir o
      // tipo completo do client aqui não pega bug nenhum e engessa o teste.
      files: ['**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
      },
    },
  ],
};
