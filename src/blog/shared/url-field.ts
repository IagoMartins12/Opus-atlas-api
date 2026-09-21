import { BadRequestException } from '@nestjs/common';
import {
  ArticleContentError,
  checkUrl,
  UrlKind,
} from '../articles/content/article-content.policy';

/**
 * Endereço opcional de um campo do blog, validado pela política de endereços.
 *
 * `undefined` segue `undefined` (o campo não veio), `null` e texto vazio viram
 * `null` (limpar o campo). Endereço recusado vira 400 com o nome do campo.
 *
 * Existia em três cópias — escrita de artigo, categorias e mídia —, cada uma
 * convertendo o erro do seu jeito.
 */
export function urlField(
  value: string | null | undefined,
  kind: UrlKind,
  field: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  return checked(value, kind, field) || null;
}

/** Endereço obrigatório: vazio também é recusado. */
export function requiredUrl(
  value: string,
  kind: UrlKind,
  field: string,
): string {
  const url = checked(value, kind, field);

  if (!url) {
    throw new BadRequestException(`${field}: endereço vazio`);
  }

  return url;
}

function checked(value: string, kind: UrlKind, field: string): string {
  try {
    return checkUrl(value, kind, field);
  } catch (error: unknown) {
    if (error instanceof ArticleContentError) {
      throw new BadRequestException(`${error.path}: ${error.reason}`);
    }

    throw error;
  }
}
