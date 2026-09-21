export interface PasswordStrengthResult {
  valid: boolean;
  errors: string[];
  score: number;
}

const SPECIAL_CHAR_PATTERN = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

/**
 * Porta `validatePasswordStrength` de `Classical-Music/src/app/libs/tokenUtils.ts`
 * — mesmas 5 regras, mesmo score. Usado apenas em `reset-password`, onde a senha
 * legada já exigia essa força (registro comum continua com a regra mais simples
 * de `RegisterDto`, sem alteração de comportamento fora do escopo pedido).
 */
export function validatePasswordStrength(
  password: string,
): PasswordStrengthResult {
  const errors: string[] = [];
  let score = 0;

  if (password.length < 8) {
    errors.push('Senha deve ter pelo menos 8 caracteres');
  } else {
    score += 1;
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Senha deve conter pelo menos uma letra minúscula');
  } else {
    score += 1;
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Senha deve conter pelo menos uma letra maiúscula');
  } else {
    score += 1;
  }

  if (!/\d/.test(password)) {
    errors.push('Senha deve conter pelo menos um número');
  } else {
    score += 1;
  }

  if (!SPECIAL_CHAR_PATTERN.test(password)) {
    errors.push('Senha deve conter pelo menos um símbolo especial');
  } else {
    score += 1;
  }

  if (password.length >= 12) {
    score += 1;
  }

  return { valid: errors.length === 0, errors, score };
}
