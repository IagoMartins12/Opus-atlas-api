/** Quem é a pessoa, segundo o ID token do Google — já verificado. */
export interface GoogleProfile {
  /** Identificador estável da conta Google (`sub`). */
  sub: string;
  email: string;
  /** `email_verified` do Google: sem ele, o e-mail não prova nada. */
  emailVerified: boolean;
  givenName: string | null;
  familyName: string | null;
  picture: string | null;
}
