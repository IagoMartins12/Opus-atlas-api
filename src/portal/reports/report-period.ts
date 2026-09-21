import { BadRequestException } from '@nestjs/common';

export const REPORT_PERIODS = [
  '1month',
  '3months',
  '6months',
  '1year',
  'all',
] as const;

export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** Teto da janela, para um relatório "de todo o período" não virar varredura total. */
const MAX_WINDOW_DAYS = 366 * 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ResolvedPeriod {
  start: Date;
  end: Date;
  label: ReportPeriod | 'custom';
  /** Janela imediatamente anterior, de mesma duração, para comparação. */
  previous: { start: Date; end: Date };
}

/**
 * Resolve a janela do relatório.
 *
 * Três diferenças em relação ao legado:
 *
 * 1. **O fim não sobrescreve o relógio.** Antes, com datas personalizadas, o
 *    código fazia `now.setTime(...)` — mutando a variável que o resto da
 *    geração usava como "agora". Tudo o que dependia do tempo corrente passava
 *    a medir a partir do fim do período pedido.
 * 2. **`all` não é `2020-01-01`.** A data fixa dava um recorte arbitrário que
 *    envelhece sozinho; agora o "todo o período" é limitado por uma janela
 *    máxima explícita e ancorada no início do vínculo.
 * 3. **Datas inválidas ou invertidas respondem 400**, em vez de virarem
 *    `Invalid Date` na consulta.
 */
export function resolvePeriod(params: {
  period?: ReportPeriod;
  from?: string;
  to?: string;
  relationshipStart?: Date;
}): ResolvedPeriod {
  const now = new Date();

  if (params.from || params.to) {
    const start = params.from ? new Date(params.from) : null;
    const end = params.to ? new Date(params.to) : now;

    if (!start || Number.isNaN(start.getTime())) {
      throw new BadRequestException('`from` não é uma data válida');
    }

    if (Number.isNaN(end.getTime())) {
      throw new BadRequestException('`to` não é uma data válida');
    }

    if (end <= start) {
      throw new BadRequestException('`to` precisa ser posterior a `from`');
    }

    if (end.getTime() - start.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
      throw new BadRequestException(
        `O período do relatório é de no máximo ${MAX_WINDOW_DAYS} dias`,
      );
    }

    return withPrevious(start, end, 'custom');
  }

  const period = params.period ?? '6months';
  const start = new Date(now);

  switch (period) {
    case '1month':
      start.setMonth(start.getMonth() - 1);
      break;
    case '3months':
      start.setMonth(start.getMonth() - 3);
      break;
    case '6months':
      start.setMonth(start.getMonth() - 6);
      break;
    case '1year':
      start.setFullYear(start.getFullYear() - 1);
      break;
    case 'all': {
      const floor = new Date(now.getTime() - MAX_WINDOW_DAYS * DAY_MS);
      const anchor = params.relationshipStart ?? floor;

      return withPrevious(anchor > floor ? anchor : floor, now, 'all');
    }
  }

  return withPrevious(start, now, period);
}

function withPrevious(
  start: Date,
  end: Date,
  label: ReportPeriod | 'custom',
): ResolvedPeriod {
  const length = end.getTime() - start.getTime();

  return {
    start,
    end,
    label,
    previous: {
      start: new Date(start.getTime() - length),
      end: new Date(start.getTime() - 1),
    },
  };
}
