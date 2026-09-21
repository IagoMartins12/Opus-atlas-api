import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errorMessage } from '../common/utils/error.util';
import {
  AiCompletionRequest,
  AiProvider,
  AiProviderConfig,
  AiProviderName,
  buildProviders,
  FetchFn,
} from './ai-providers';

export interface AiCompletion {
  text: string;
  /** `provedor/modelo` que respondeu, ex.: `anthropic/claude-opus-5`. */
  generatedBy: string;
}

/** Nenhum provedor configurado, ou todos falharam. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

interface AiConfig {
  providerOrder: string[];
  timeoutMs: number;
  anthropic: AiProviderConfig;
  openai: AiProviderConfig;
  groq: AiProviderConfig;
}

/**
 * Texto por IA, em cascata: pergunta ao primeiro provedor da lista e, se ele
 * falhar (fora do ar, cota, chave inválida, demora, resposta vazia), ao
 * seguinte.
 *
 * **A ordem é configuração, não código** — `AI_PROVIDER_ORDER`, padrão
 * `anthropic,openai,groq`: o principal primeiro, o gratuito por último. Trocar
 * a ordem, tirar um provedor ou trocar o modelo (`ANTHROPIC_MODEL`,
 * `OPENAI_MODEL`, `GROQ_MODEL`) não pede deploy de código.
 *
 * O legado tinha a ordem fixa no código (Groq, depois OpenAI) e, se tudo
 * falhasse, devolvia uma biografia-modelo genérica — "contribuiu
 * significativamente para o repertório de sua época" — gravada como se fosse
 * dado. Aqui, falha é falha: quem chama decide o que mostrar.
 */
@Injectable()
export class AiTextService {
  private readonly logger = new Logger(AiTextService.name);
  private readonly providers: AiProvider[];
  private readonly timeoutMs: number;

  constructor(config: ConfigService, fetchFn: FetchFn = fetch) {
    const ai = config.get<AiConfig>('ai');
    const configs: Partial<Record<AiProviderName, AiProviderConfig>> = {
      anthropic: ai?.anthropic,
      openai: ai?.openai,
      groq: ai?.groq,
    };

    this.providers = buildProviders(ai?.providerOrder ?? [], configs, fetchFn);
    this.timeoutMs = ai?.timeoutMs ?? 60_000;

    this.logger.log(
      this.providers.length > 0
        ? `IA em cascata: ${this.chain().join(' → ')}`
        : 'IA desligada: nenhum provedor com chave',
    );
  }

  get enabled(): boolean {
    return this.providers.length > 0;
  }

  /** A cascata efetiva, na ordem — para log e diagnóstico. */
  chain(): string[] {
    return this.providers.map(
      (provider) => `${provider.name}/${provider.model}`,
    );
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    if (this.providers.length === 0) {
      throw new AiUnavailableError('Nenhum provedor de IA configurado');
    }

    const failures: string[] = [];

    for (const provider of this.providers) {
      const generatedBy = `${provider.name}/${provider.model}`;

      try {
        const text = (
          await provider.complete(request, AbortSignal.timeout(this.timeoutMs))
        ).trim();

        if (!text) {
          throw new Error('resposta vazia');
        }

        return { text, generatedBy };
      } catch (error: unknown) {
        const reason = errorMessage(error);
        failures.push(`${generatedBy}: ${reason}`);
        this.logger.warn(
          `IA: ${generatedBy} falhou (${reason}); tentando o próximo`,
        );
      }
    }

    throw new AiUnavailableError(
      `Todos os provedores de IA falharam — ${failures.join('; ')}`,
    );
  }
}
