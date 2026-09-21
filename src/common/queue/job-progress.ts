/**
 * Progresso de um job, com a frase que explica o número.
 *
 * **O `updateProgress` recebia só o percentual, e a frase era perdida.** O
 * scraper já produzia as duas coisas — `onProgress(80, '124 eventos coletados.
 * Importando...')` —, mas o processor gravava o número em
 * `job.updateProgress(percent)` e mandava o texto para `job.log()`, que não é
 * lido por rota nenhuma. Quem olhasse o job via API via "80" sem saber 80 do
 * quê: se estava baixando página, importando evento ou esperando o site
 * responder. Numa varredura que leva minutos, essa é justamente a informação
 * que faz esperar em vez de cancelar.
 */
export interface JobProgress {
  /** 0–100, inteiro. */
  percent: number;
  /** O que está acontecendo agora. `null` quando o processor não disse. */
  message: string | null;
}

/**
 * Teto da frase de progresso.
 *
 * O progresso é regravado no Redis a cada tique, e a frase vem de dado
 * externo — título de página, nome de casa de espetáculo. Sem teto, um único
 * job mal-comportado escreve quilobytes por segundo na fila.
 */
export const MAX_PROGRESS_MESSAGE = 200;

/** Alvo mínimo de `Job` para reportar progresso, sem depender do BullMQ aqui. */
export interface ProgressReporter {
  updateProgress(progress: JobProgress): Promise<void>;
}

/**
 * Reporta o progresso sem que uma falha no relato derrube o trabalho.
 *
 * **Gravar progresso é rede, e rede falha.** Se o Redis piscar no meio de uma
 * varredura que já coletou duzentos eventos, perder o tique é irrelevante e
 * perder a varredura não é. O código anterior fazia `void job.updateProgress(…)`
 * solto: a promessa rejeitada não tinha quem a tratasse, e uma rejeição não
 * tratada derruba o processo inteiro do worker no Node — matando junto todos os
 * outros jobs que estivessem rodando nele.
 */
export function reportProgress(
  job: ProgressReporter,
  percent: number,
  message?: string | null,
): void {
  void job
    .updateProgress(buildProgress(percent, message))
    .catch(() => undefined);
}

export function buildProgress(
  percent: number,
  message?: string | null,
): JobProgress {
  const trimmed = message?.trim();

  return {
    percent: clampPercent(percent),
    message: trimmed ? trimmed.slice(0, MAX_PROGRESS_MESSAGE) : null,
  };
}

/**
 * Lê o progresso gravado, seja qual for o formato.
 *
 * **O número solto continua sendo aceito de propósito.** No instante do deploy
 * existem jobs no Redis cujo progresso foi gravado pela versão anterior, como
 * `75`. Se a leitura só entendesse o formato novo, todos eles apareceriam sem
 * progresso nenhum até saírem da retenção — sete dias de tela mentindo por uma
 * mudança de formato.
 */
export function readProgress(raw: unknown): JobProgress | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { percent: clampPercent(raw), message: null };
  }

  if (typeof raw !== 'object' || raw === null) {
    return null;
  }

  const candidate = raw as { percent?: unknown; message?: unknown };

  if (
    typeof candidate.percent !== 'number' ||
    !Number.isFinite(candidate.percent)
  ) {
    return null;
  }

  return {
    percent: clampPercent(candidate.percent),
    message:
      typeof candidate.message === 'string' && candidate.message.trim()
        ? candidate.message.slice(0, MAX_PROGRESS_MESSAGE)
        : null,
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}
