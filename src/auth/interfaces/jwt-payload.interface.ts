export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: number;
  isTeacher: boolean;
  isStudent: boolean;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  /** Nonce único — sem ele, dois tokens emitidos no mesmo segundo para o mesmo
   * usuário seriam byte-idênticos (mesmo `sub`/`type`/`iat`), colidindo no
   * índice único de `UserToken.token`. */
  jti: string;
}
