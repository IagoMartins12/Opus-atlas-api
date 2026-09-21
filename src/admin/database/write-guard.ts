import { BadRequestException } from '@nestjs/common';
import { FieldInfo } from './field-policy';
import { ModelInfo, ModelRegistry } from './model-registry';

/**
 * Frase de confirmação exigida em toda escrita.
 *
 * **A escrita genérica contorna toda regra de negócio da plataforma** — as
 * validações de papel, a proteção do último super admin, os limites de plano, as
 * regras de cupom, as checagens de dono. Isso é assumido: a decisão de manter a
 * escrita ampla foi tomada de propósito, e a trava fica no processo.
 *
 * A frase é o que separa "cliquei sem querer" de "eu quis". Ela é determinística
 * e cita o alvo, então não pode ser reaproveitada de outra operação: a frase que
 * apaga 3 registros de `Coupon` não serve para apagar 300, nem para apagar
 * `User`. E a mensagem de erro diz exatamente qual frase é esperada — travar
 * alguém adivinhando não protege nada, só irrita.
 */
export function createPhrase(model: ModelInfo): string {
  return `CRIAR ${model.name}`;
}

export function updatePhrase(model: ModelInfo, id: string): string {
  return `ATUALIZAR ${model.name} ${id}`;
}

export function deletePhrase(model: ModelInfo, count: number): string {
  return `APAGAR ${count} ${model.name}`;
}

export function assertConfirmation(expected: string, received?: string): void {
  if (received?.trim() !== expected) {
    throw new BadRequestException(
      `Confirmação ausente ou incorreta. Envie \`confirmation\` exatamente como: "${expected}".`,
    );
  }
}

/**
 * Valida os campos de um corpo de escrita.
 *
 * O legado passava `data` direto para `prisma.create` e `prisma.update`. Aqui
 * cada chave precisa existir no model, não pode ser protegida, e não pode ser
 * gerada pelo banco — três recusas que o `registry.field` e o teste abaixo
 * fazem antes de qualquer coisa tocar o Prisma.
 */
export function assertWritableData(
  registry: ModelRegistry,
  model: ModelInfo,
  data: Record<string, unknown>,
): FieldInfo[] {
  const keys = Object.keys(data);

  if (keys.length === 0) {
    throw new BadRequestException('Nenhum campo informado.');
  }

  return keys.map((key) => {
    const field = registry.field(model, key);

    if (field.isId) {
      throw new BadRequestException(
        `O identificador "${field.name}" é definido pelo banco e não pode ser escrito.`,
      );
    }

    if (field.name === 'createdAt' || field.name === 'updatedAt') {
      throw new BadRequestException(
        `"${field.name}" é mantido pelo banco e não pode ser escrito à mão.`,
      );
    }

    return field;
  });
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * Diferença campo a campo, para a trilha de auditoria.
 *
 * É o que transforma "alguém editou um usuário" em "fulano mudou `role` de 0
 * para 2 às 3h12". Sem o antes, a trilha registra que houve escrita e não o que
 * mudou — e numa rota que pode promover contas, é o antes que importa.
 *
 * Valor de campo protegido nunca entra aqui: eles são recusados antes, então o
 * diff não tem como carregar segredo para dentro do `AdminAuditLog`.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: FieldInfo[],
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const field of fields) {
    const from = before[field.name];
    const to = after[field.name];

    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
      changes.push({ field: field.name, from: from ?? null, to: to ?? null });
    }
  }

  return changes;
}
