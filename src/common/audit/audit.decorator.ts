import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'auditAction';

export interface AuditOptions {
  /** Identificador estável da ação, ex.: `user.delete`, `plan-pricing.update`. */
  action: string;
  /** Tipo da entidade afetada, ex.: `user`, `coupon`. */
  entityType?: string;
  /** Nome do parâmetro de rota que carrega o id da entidade, ex.: `id`. */
  entityIdParam?: string;
}

/**
 * Marca uma rota como auditável (SPEC §3.8).
 *
 * O registro é feito pelo `AuditInterceptor`, tanto no sucesso quanto na falha
 * — tentativa de ação administrativa negada é justamente o que se quer ver numa
 * investigação.
 *
 * @example
 * ```ts
 * @Audited({ action: 'user.delete', entityType: 'user', entityIdParam: 'id' })
 * @Delete(':id')
 * remove(@Param('id') id: string) { ... }
 * ```
 */
export const Audited = (options: AuditOptions) =>
  SetMetadata(AUDIT_ACTION_KEY, options);
