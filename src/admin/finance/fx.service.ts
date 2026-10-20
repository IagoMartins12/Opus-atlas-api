import { Injectable, Logger } from '@nestjs/common';
import { errorMessage } from '../../common/utils/error.util';

const BCB =
  'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia';
const TIMEOUT_MS = 5_000;
/** Fim de semana e feriado não têm boletim: volta até achar um dia útil. */
const LOOKBACK_DAYS = 7;

/**
 * A cotação em reais de uma moeda estrangeira, pela PTAX de venda do Banco
 * Central no dia do lançamento. O valor fica guardado no lançamento, para o
 * histórico não mudar quando o dólar mudar.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  /** BRL por unidade, ou `null` se o Banco Central não respondeu. */
  async rateFor(currency: string, date: Date): Promise<number | null> {
    if (currency === 'BRL') return 1;

    for (let back = 0; back <= LOOKBACK_DAYS; back++) {
      const day = new Date(date.getTime() - back * 86_400_000);
      const rate = await this.fetchRate(currency, day);
      if (rate === 'error') return null;
      if (rate !== null) return rate;
    }
    return null;
  }

  private async fetchRate(
    currency: string,
    day: Date,
  ): Promise<number | null | 'error'> {
    const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(day.getUTCDate()).padStart(2, '0');
    const url =
      `${BCB}(moeda=@moeda,dataCotacao=@dataCotacao)` +
      `?@moeda='${currency}'&@dataCotacao='${mm}-${dd}-${day.getUTCFullYear()}'` +
      `&$format=json&$select=cotacaoVenda`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return 'error';
      const body = (await response.json()) as {
        value?: { cotacaoVenda?: number }[];
      };
      const last = body.value?.at(-1)?.cotacaoVenda;
      return typeof last === 'number' && last > 0 ? last : null;
    } catch (error: unknown) {
      this.logger.warn(`PTAX indisponível: ${errorMessage(error)}`);
      return 'error';
    }
  }
}
