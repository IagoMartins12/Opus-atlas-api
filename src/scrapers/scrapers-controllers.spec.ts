import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { BaseScraper, ScraperConfig } from './base/base-scraper';
import { ImslpController } from './imslp/imslp.controller';
import { ScraperRegistry, SCRAPER_IDS } from './scraper-registry';
import { ScrapersController } from './scrapers.controller';
import { WikipediaController } from './wikipedia/wikipedia.controller';

const admin: AccessTokenPayload = {
  sub: 'a1',
  email: 'admin@x.com',
  role: 1,
  isTeacher: false,
  isStudent: false,
  type: 'access',
};

const scraperWith = (venueName: string) =>
  ({
    getConfig: () => ({
      venueName,
      venueSlug: venueName.toLowerCase(),
      baseUrl: `https://${venueName}.br`,
    }),
  }) as unknown as BaseScraper;

function registry() {
  const scrapers = SCRAPER_IDS.map((id) => scraperWith(id));
  return {
    registry: new (ScraperRegistry as unknown as new (
      ...s: BaseScraper[]
    ) => ScraperRegistry)(...scrapers),
    scrapers,
  };
}

describe('ScraperRegistry', () => {
  it('lista as casas com nome, slug e endereço', () => {
    const { registry: reg } = registry();

    expect(reg.list()).toHaveLength(SCRAPER_IDS.length);
    expect(reg.list()[0]).toEqual({
      id: 'osesp',
      venueName: 'osesp',
      venueSlug: 'osesp',
      baseUrl: 'https://osesp.br',
    });
  });

  it('id conhecido devolve o scraper; desconhecido é 400', () => {
    const { registry: reg, scrapers } = registry();

    expect(reg.require('osesp')).toBe(scrapers[0]);
    expect(reg.isRegistered('osesp')).toBe(true);
    expect(reg.isRegistered('teatro-x')).toBe(false);
    expect(() => reg.requireId('teatro-x')).toThrow(BadRequestException);
  });
});

describe('ScrapersController', () => {
  const dispatch = {
    enqueue: jest.fn().mockResolvedValue({ jobId: 'j1' }),
    enqueueAll: jest.fn().mockResolvedValue({ jobs: [] }),
    listSchedules: jest.fn().mockResolvedValue([]),
    setSchedule: jest.fn().mockResolvedValue({ ok: true }),
    removeSchedule: jest.fn().mockResolvedValue(true),
  };
  const controller = new ScrapersController(
    registry().registry,
    dispatch as never,
  );

  it('lista, roda uma casa e todas', async () => {
    expect(controller.list().scrapers).toHaveLength(SCRAPER_IDS.length);
    await controller.run('osesp', admin);
    await controller.runAll(admin);

    expect(dispatch.enqueue).toHaveBeenCalledWith('osesp', 'a1');
    expect(dispatch.enqueueAll).toHaveBeenCalledWith('a1');
    await expect(controller.run('inventada', admin)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('agendamentos: ver, pôr e tirar (inexistente é 404)', async () => {
    await controller.schedules();
    await controller.setSchedule(
      'osesp',
      { cron: '0 6 * * *' } as never,
      admin,
    );
    expect(dispatch.setSchedule).toHaveBeenCalledWith({
      scraperId: 'osesp',
      cron: '0 6 * * *',
      requestedBy: 'a1',
    });

    await expect(controller.removeSchedule('osesp')).resolves.toEqual({
      scraperId: 'osesp',
      removed: true,
    });
    dispatch.removeSchedule.mockResolvedValue(false);
    await expect(controller.removeSchedule('osesp')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ImslpController e WikipediaController', () => {
  it('repassam aos raspadores e à importação', async () => {
    const workScraper = { scrape: jest.fn().mockResolvedValue('obra') };
    const composerWorks = { discover: jest.fn().mockResolvedValue('obras') };
    const importer = { importWorks: jest.fn().mockResolvedValue('importadas') };
    const composerScraper = {
      scrape: jest.fn().mockResolvedValue('compositor'),
    };
    const controller = new ImslpController(
      workScraper as never,
      composerWorks as never,
      importer as never,
      composerScraper as never,
    );

    await expect(
      controller.scrapeComposer({ url: 'u' } as never),
    ).resolves.toBe('compositor');
    await expect(controller.scrapeWork({ url: 'u' } as never)).resolves.toBe(
      'obra',
    );
    await expect(controller.discoverWorks('c1')).resolves.toBe('obras');
    await controller.importWorks('c1', { urls: ['u1'] } as never, admin);
    expect(importer.importWorks).toHaveBeenCalledWith({
      composerId: 'c1',
      urls: ['u1'],
      userId: 'a1',
    });

    const wikipedia = { scrape: jest.fn().mockResolvedValue('wiki') };
    await expect(
      new WikipediaController(wikipedia as never).scrapeComposer({
        url: 'w',
      } as never),
    ).resolves.toBe('wiki');
  });

  // Decisão de 15/09: raspar uma página é de quem contribui (basta login);
  // descobrir e importar em lote segue só administrador.
  it('raspar é aberto a quem tem login; descobrir e importar, só ADMIN', () => {
    const roles = (
      method: 'scrapeComposer' | 'scrapeWork' | 'discoverWorks' | 'importWorks',
    ) =>
      Reflect.getMetadata(
        'roles',
        ImslpController.prototype[method],
      ) as unknown;

    expect(Reflect.getMetadata('roles', ImslpController)).toBeUndefined();
    expect(Reflect.getMetadata('roles', WikipediaController)).toBeUndefined();
    expect(roles('scrapeComposer')).toBeUndefined();
    expect(roles('scrapeWork')).toBeUndefined();
    expect(roles('discoverWorks')).toEqual(['ADMIN']);
    expect(roles('importWorks')).toEqual(['ADMIN']);
  });
});

describe('BaseScraper', () => {
  const config: ScraperConfig = {
    venueName: 'Sala',
    venueSlug: 'sala',
    baseUrl: 'https://sala.br',
    venue: { address: 'Rua', city: 'SP', state: 'SP', country: 'BR' },
    delayBetweenRequests: 0,
  };

  class Sala extends BaseScraper {
    delays: number[] = [];
    async scrapeEvents() {
      return [];
    }
    protected override async delay(ms?: number) {
      this.delays.push(ms ?? -1);
    }
    fetch(url: string, retries?: number) {
      return this.fetchWithRetry(url, retries);
    }
    error(e: unknown) {
      this.logError(e);
    }
    say(message: string) {
      this.log(message);
    }
    wait(ms?: number) {
      return super.delay(ms);
    }
  }

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('tenta de novo com espera crescente, e desiste na última', async () => {
    const sala = new Sala(config);
    const get = jest
      .spyOn(sala['httpClient'], 'get')
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({ data: '<html>' });

    await expect(sala.fetch('/agenda')).resolves.toBe('<html>');
    expect(sala.delays).toEqual([3000]);

    get.mockRejectedValue(new Error('fora'));
    await expect(sala.fetch('/agenda', 2)).rejects.toThrow('fora');
  });

  it('zero tentativas é erro explícito', async () => {
    await expect(new Sala(config).fetch('/x', 0)).rejects.toThrow(
      'Max retries exceeded',
    );
  });

  // O scraper é singleton: sem zerar, os erros de ontem aparecem hoje.
  it('erros vão para o estado, e a rodada nova começa limpa', () => {
    const sala = new Sala(config);
    sala.error(new Error('seletor mudou'));
    sala.say('ok');

    expect(sala.getState().errors).toEqual(['seletor mudou']);
    sala.resetState();
    expect(sala.getState().errors).toEqual([]);
    expect(sala.getConfig().venueName).toBe('Sala');
  });

  it('a espera padrão usa o intervalo configurado', async () => {
    jest.useFakeTimers();
    const pending = new Sala(config).wait();
    jest.advanceTimersByTime(1);
    await expect(pending).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});
