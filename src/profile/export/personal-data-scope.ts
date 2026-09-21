/**
 * O que entra e o que não entra na exportação de dados pessoais.
 *
 * **RN-2 do ROADMAP: o direito de portabilidade (LGPD, Art. 18, V).** A
 * plataforma já cobria bem o direito de eliminação — `delete-account` com
 * `cascade-info` — e não tinha nenhuma forma de a pessoa levar os próprios
 * dados embora. Ela é brasileira, cobra em BRL e guarda dado de menor de idade
 * no portal do aluno; a ausência não era detalhe.
 *
 * Decidir o escopo é a parte difícil, e cada exclusão abaixo tem motivo.
 */

/**
 * **Credenciais nunca são exportadas.**
 *
 * `Account` (tokens de OAuth), `Session` (token de sessão), `UserToken` (reset
 * de senha, confirmação de e-mail, descadastro) e `hashedPassword`.
 *
 * Portabilidade é o direito de levar embora os **seus dados**, não as chaves
 * que dão acesso à sua conta. Um arquivo de exportação circula por e-mail,
 * fica em pasta de download, é aberto em computador compartilhado — colocar um
 * token de sessão válido dentro dele transforma o exercício de um direito num
 * vazamento de credencial.
 */
export const EXCLUDED_CREDENTIALS = [
  'Account',
  'Session',
  'UserToken',
  'User.hashedPassword',
] as const;

/**
 * **Atos sobre o conteúdo de terceiros não são exportados.**
 *
 * `AdminAuditLog.actorId`, `UploadModeration.moderatedBy`,
 * `WorkAnnotation.moderatedBy` e os vários `verifiedBy`.
 *
 * São registros do que a pessoa fez **com o dado de outra**. Um moderador que
 * pede a própria exportação receberia, junto, o histórico de decisões sobre
 * conteúdo alheio — e a trilha administrativa não é dado pessoal dele, é
 * registro da operação da plataforma. Ele continua tendo acesso a isso pelas
 * rotas administrativas, com a autorização que elas exigem.
 */
export const EXCLUDED_ACTS_ON_OTHERS = [
  'AdminAuditLog',
  'UploadModeration.moderatedBy',
  'WorkAnnotation.moderatedBy',
  'verifiedBy',
] as const;

/**
 * **Campos privados da contraparte saem do registro compartilhado.**
 *
 * Aula e tarefa pertencem a duas pessoas. O que o professor anotou **sobre** o
 * aluno é dado pessoal do aluno e vai na exportação dele; o que o professor
 * anotou **para si** (`teacherNotes`) é avaliação privada e não vai. O inverso
 * também vale: o feedback que o aluno escreveu sobre a aula é dele.
 *
 * É a única parte do escopo em que a mesma linha do banco aparece diferente
 * conforme quem exporta.
 */
export const COUNTERPART_PRIVATE_FIELDS = {
  /** Notas privadas do professor: não vão para a exportação do aluno. */
  lessonTeacherOnly: ['teacherNotes'],
} as const;

/** Versão do formato, para quem receber o arquivo saber lê-lo. */
export const EXPORT_FORMAT_VERSION = '1.0';
