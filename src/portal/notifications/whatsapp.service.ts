import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errorMessage } from '../../common/utils/error.util';

type FetchFn = typeof fetch;

/**
 * Os modelos de mensagem aprovados na Meta (categoria "utilidade"), um por
 * tema do portal. O texto de cada um está no ROADMAP (7.9.15-A), para criar
 * igual no Meta Business; os nomes daqui precisam bater com os de lá.
 *
 * Os três parâmetros são sempre os mesmos: o título do aviso, o texto e o
 * link para abrir no portal.
 */
export const WHATSAPP_TEMPLATES: Record<string, string> = {
  'lesson-reminder': 'opus_aula_lembrete',
  'lesson-change': 'opus_aula_mudanca',
  'lesson-request': 'opus_aula_pedido',
  absence: 'opus_aluno_falta',
};

export interface WhatsAppResult {
  delivered: boolean;
  /** Erro permanente (número inválido, sem aceite na Meta): não tenta de novo. */
  permanent?: boolean;
  error?: string;
}

/**
 * "+55 (11) 99999-9999", "11999999999" → "5511999999999" (E.164 sem o "+",
 * como a Cloud API pede). Sem "+", número brasileiro ganha o 55. `null`
 * quando não dá para ser um telefone.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  // Com "+", o DDI veio junto; sem ele, 10 ou 11 dígitos são DDD + número.
  const full =
    !text.startsWith('+') && (digits.length === 10 || digits.length === 11)
      ? `55${digits}`
      : digits;
  return full.length >= 11 && full.length <= 15 ? full : null;
}

/**
 * Envio de WhatsApp pela API oficial da Meta (Cloud API), direto, sem
 * intermediário (decisão de 22/10: custo só da Meta, integração por HTTP).
 *
 * Fora da janela de 24 h de conversa, a Meta só aceita **modelo aprovado**:
 * por isso todo aviso sai por modelo, nunca por texto livre.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly token?: string;
  private readonly phoneNumberId?: string;
  private readonly apiVersion: string;
  private readonly language: string;

  constructor(
    config: ConfigService,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    const wa = config.get<{
      token?: string;
      phoneNumberId?: string;
      apiVersion?: string;
      templateLanguage?: string;
    }>('whatsapp');
    this.token = wa?.token || undefined;
    this.phoneNumberId = wa?.phoneNumberId || undefined;
    this.apiVersion = wa?.apiVersion ?? 'v23.0';
    this.language = wa?.templateLanguage ?? 'pt_BR';
  }

  /** O canal só existe com token e número configurados. */
  get enabled(): boolean {
    return Boolean(this.token && this.phoneNumberId);
  }

  async sendTemplate(input: {
    to: string;
    template: string;
    params: string[];
  }): Promise<WhatsAppResult> {
    if (!this.enabled) return { delivered: false, permanent: true };
    const to = normalizePhone(input.to);
    if (!to)
      return { delivered: false, permanent: true, error: 'telefone inválido' };

    try {
      const response = await this.fetchFn(
        `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
              name: input.template,
              language: { code: this.language },
              components: [
                {
                  type: 'body',
                  // A Meta recusa parâmetro vazio ou com quebra de linha.
                  parameters: input.params.map((text) => ({
                    type: 'text',
                    text: text.replace(/\s+/g, ' ').trim().slice(0, 900) || '-',
                  })),
                },
              ],
            },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (response.ok) return { delivered: true };

      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string; code?: number };
      } | null;
      const message = body?.error?.message ?? `HTTP ${response.status}`;
      // 4xx é do pedido (número, modelo, aceite): tentar de novo não muda.
      // 429 e 5xx passam.
      const permanent =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429;
      this.logger.warn(`WhatsApp não enviado: ${message}`);
      return { delivered: false, permanent, error: message };
    } catch (error) {
      this.logger.warn(`WhatsApp não enviado: ${errorMessage(error)}`);
      return { delivered: false, error: errorMessage(error) };
    }
  }
}
