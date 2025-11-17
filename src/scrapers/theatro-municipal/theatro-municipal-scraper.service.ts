import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  BaseScraper,
  ScraperConfig,
  ScraperResponse,
} from '../base/base-scraper';
import { PrismaService } from '../../prisma/prisma.service';
import { ScrapedEvent } from '../../common/interfaces/scraped-event.interface';
import * as cheerio from 'cheerio';
import puppeteer, { Browser } from 'puppeteer-core';
import { extractComposerNames } from '../../utils/text-cleaner';
import { createSlug } from '../../utils/date-parser';
import * as fs from 'fs';

interface TheatroMunicipalScraperOptions {
  headless?: boolean;
  timeout?: number;
  maxRetries?: number;
  startDate?: Date;
  endDate?: Date;
}

@Injectable()
export class TheatroMunicipalScraperService
  extends BaseScraper
  implements OnModuleDestroy
{
  private browser: Browser | null = null;
  private options: Required<TheatroMunicipalScraperOptions>;

  constructor(private prisma: PrismaService) {
    const config: ScraperConfig = {
      venueName: 'Theatro Municipal de São Paulo',
      venueSlug: 'theatro-municipal',
      baseUrl: 'https://theatromunicipal.org.br',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      delayBetweenRequests: 1500,
    };
    super(config);

    this.options = {
      headless: true,
      timeout: 60000,
      maxRetries: 3,
      startDate: new Date(),
      endDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
    };
  }

  /**
   * 🧹 Cleanup ao destruir o módulo
   */
  async onModuleDestroy() {
    await this.cleanup();
  }

  /**
   * 🚀 INICIALIZAR BROWSER
   */
  private async initBrowser(): Promise<void> {
    if (this.browser) {
      this.log('⚠️ Browser já está inicializado');
      return;
    }

    try {
      const chromePath = this.findChrome();

      this.log('🚀 Iniciando Puppeteer...');
      this.browser = await puppeteer.launch({
        headless: true,
        executablePath: chromePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-sync',
          '--metrics-recording-only',
          '--no-first-run',
          '--mute-audio',
        ],
      });

      this.log('✅ Browser inicializado com sucesso');
    } catch (error) {
      this.log(`❌ Erro ao inicializar browser: ${error.message}`);
      throw error;
    }
  }

  /**
   * 🔍 ENCONTRAR CHROME
   */
  private findChrome(): string {
    const possiblePaths = [
      '/usr/bin/chromium-browser', // Alpine Linux (Docker)
      '/usr/bin/chromium', // Algumas distros Linux
      '/usr/bin/google-chrome-stable', // Google Chrome
      '/usr/bin/google-chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Windows
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];

    for (const path of possiblePaths) {
      if (fs.existsSync(path)) {
        this.log(`✅ Chrome encontrado: ${path}`);
        return path;
      }
    }

    // Usar variável de ambiente se configurada
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      this.log(
        `✅ Usando Chrome do env: ${process.env.PUPPETEER_EXECUTABLE_PATH}`,
      );
      return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    throw new Error(
      'Chrome não encontrado. Certifique-se de que o Chromium está instalado no container.',
    );
  }

  /**
   * 🧹 CLEANUP
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('✅ Browser fechado');
    }
  }

  /**
   * 🎯 MÉTODO PRINCIPAL - Scrape de eventos
   */
  async scrapeEvents(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScrapedEvent[]> {
    try {
      // 1. Inicializar browser (0% - 10%)
      onProgress?.(0, 100, 'Inicializando browser...');
      await this.initBrowser();
      onProgress?.(10, 100, 'Browser inicializado');

      const startDateStr = this.formatDate(this.options.startDate);
      const endDateStr = this.formatDate(this.options.endDate);

      const baseUrl = `https://theatromunicipal.org.br/programacao/?jsf=jet-engine:q1&meta=data_inicial_timestamp!date:${startDateStr}-${endDateStr}`;

      console.log(`🎭 Buscando eventos do Theatro Municipal...`);
      console.log(`📅 Período: ${startDateStr} a ${endDateStr}`);

      // 2. Coletar URLs (10% - 40%)
      onProgress?.(15, 100, 'Carregando página...');

      const page = await this.browser!.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(this.config.userAgent!);

      await page.goto(baseUrl, {
        waitUntil: 'networkidle2',
        timeout: this.options.timeout,
      });

      await page.waitForSelector('.jet-listing-grid__items', {
        timeout: 10000,
      });

      await this.delay(3000);

      let allEventUrls: string[] = [];
      let currentPage = 1;
      let hasNextPage = true;

      // Coletar URLs de todos os eventos (com paginação)
      while (hasNextPage) {
        const pageProgress = 20 + Math.min(currentPage * 5, 20);
        onProgress?.(
          pageProgress,
          100,
          `Coletando URLs da página ${currentPage}...`,
        );

        console.log(`📄 Coletando URLs da página ${currentPage}...`);

        const eventUrls = await page.evaluate(() => {
          const urls: string[] = [];
          const items = document.querySelectorAll('.jet-listing-grid__item');

          items.forEach((item) => {
            const titleLink = item.querySelector(
              'h3.elementor-heading-title a',
            ) as HTMLAnchorElement;

            if (
              titleLink &&
              titleLink.href &&
              titleLink.href.includes('/eventos/')
            ) {
              urls.push(titleLink.href);
            }
          });

          return urls;
        });

        console.log(`  ✅ ${eventUrls.length} eventos encontrados`);
        allEventUrls = [...allEventUrls, ...eventUrls];

        const loadMoreButton = await page.$('#ver-mais-eventos');

        if (loadMoreButton) {
          try {
            console.log(`  ➡️ Clicando em "Ver mais eventos"...`);
            await loadMoreButton.click();
            await this.delay(3000);

            const newCount = await page.evaluate(() => {
              return document.querySelectorAll('.jet-listing-grid__item')
                .length;
            });

            console.log(`  📊 Total de ${newCount} eventos carregados`);
            currentPage++;
          } catch {
            console.log(`  ⚠️ Erro ao clicar em "Ver mais"`);
            hasNextPage = false;
          }
        } else {
          hasNextPage = false;
          console.log(`  ✅ Todos os eventos carregados`);
        }

        if (currentPage > 10) {
          console.log(`  ⚠️ Limite de páginas atingido`);
          break;
        }
      }

      await page.close();

      allEventUrls = [...new Set(allEventUrls)];
      console.log(
        `📊 Total de ${allEventUrls.length} eventos únicos encontrados`,
      );

      onProgress?.(
        40,
        100,
        `${allEventUrls.length} eventos únicos encontrados`,
      );

      // 3. Scrape detalhes de cada evento (40% - 100%)
      const events: ScrapedEvent[] = [];
      const totalUrls = allEventUrls.length;

      for (let i = 0; i < totalUrls; i++) {
        const url = allEventUrls[i];

        const progressPercentage = 40 + Math.round((i / totalUrls) * 60);
        onProgress?.(
          progressPercentage,
          100,
          `Processando evento ${i + 1}/${totalUrls}...`,
        );

        console.log(`\n[${i + 1}/${totalUrls}] Processando: ${url}`);

        try {
          // ✅ AGORA RETORNA ARRAY
          const eventSessions = await this.scrapeEventDetails(url);

          if (eventSessions && eventSessions.length > 0) {
            events.push(...eventSessions); // ✅ Adicionar todas as sessões
            this.state.eventsScraped += eventSessions.length;
          } else {
            console.log(`  ⚠️ Evento pulado (dados incompletos)`);
          }
        } catch (error) {
          console.error(`  ❌ Erro ao processar evento:`, error);
          this.state.errors.push(`Failed to scrape ${url}: ${error}`);
        }

        await this.delay(1500);
      }

      this.state.eventsFound = totalUrls;

      console.log(
        `\n✅ Scraping concluído: ${events.length} eventos processados`,
      );
      return events;
    } catch (error) {
      console.error('❌ Erro no scraping:', error);
      onProgress?.(0, 100, `Erro: ${error.message}`);
      throw error;
    }
  }

  /**
   * ✅ MÉTODO COMPLETO: Scrape + Verificação de Duplicatas COM PROGRESSO
   */
  async scrapeAndCheckDuplicates(
    onProgress?: (current: number, total: number, message: string) => void,
  ): Promise<ScraperResponse> {
    const startTime = Date.now();

    try {
      this.state = {
        eventsFound: 0,
        eventsScraped: 0,
        errors: [],
        startTime: Date.now(),
      };

      onProgress?.(0, 100, 'Iniciando browser...');

      // ✅ PASSAR CALLBACK DE PROGRESSO (0-80%)
      const scrapedEvents = await this.scrapeEvents(
        (current, total, message) => {
          const mappedProgress = Math.round((current / 100) * 80);
          onProgress?.(mappedProgress, 100, message);
        },
      );

      onProgress?.(
        80,
        100,
        `${scrapedEvents.length} eventos coletados. Verificando duplicatas...`,
      );

      const allEvents: ScrapedEvent[] = [];
      let duplicates = 0;
      const total = scrapedEvents.length;

      for (let i = 0; i < scrapedEvents.length; i++) {
        const event = scrapedEvents[i];

        // ✅ PROGRESSO (80% - 100%)
        const progressPercentage = 80 + Math.round((i / total) * 20);
        onProgress?.(
          progressPercentage,
          100,
          `Verificando duplicatas: ${i + 1}/${total}`,
        );

        const existingEvent = await this.prisma.event.findFirst({
          where: {
            OR: [
              { externalId: event.externalId },
              {
                AND: [{ title: event.title }, { startDate: event.startDate }],
              },
            ],
          },
          select: {
            id: true,
            slug: true,
          },
        });

        if (existingEvent) {
          duplicates++;
          allEvents.push({
            ...event,
            isDuplicate: true,
            existingEventId: existingEvent.id,
            existingEventSlug: existingEvent.slug,
          } as any);
          this.log(`⚠️ Duplicata detectada: ${event.title}`);
        } else {
          allEvents.push({
            ...event,
            isDuplicate: false,
          } as any);
        }
      }

      const executionTime = Date.now() - startTime;
      onProgress?.(100, 100, 'Scraper concluído!');

      this.log(`
📊 Resumo:
- Total scraped: ${scrapedEvents.length}
- Novos eventos: ${allEvents.filter((e: any) => !e.isDuplicate).length}
- Duplicatas: ${duplicates}
- Tempo: ${executionTime}ms
    `);

      return {
        success: true,
        eventsFound: this.state.eventsFound,
        eventsScraped: this.state.eventsScraped,
        newEvents: allEvents.filter((e: any) => !e.isDuplicate).length,
        duplicates,
        events: allEvents,
        errors: this.state.errors,
        executionTime,
      };
    } catch (error) {
      onProgress?.(0, 100, `Erro: ${error.message}`);

      return {
        success: false,
        eventsFound: 0,
        eventsScraped: 0,
        newEvents: 0,
        duplicates: 0,
        events: [],
        errors: [error instanceof Error ? error.message : String(error)],
        executionTime: Date.now() - startTime,
      };
    } finally {
      await this.cleanup();
      this.state = {
        eventsFound: 0,
        eventsScraped: 0,
        errors: [],
        startTime: Date.now(),
      };
    }
  }
  /**
   * 🎭 SCRAPE DETALHES DO EVENTO
   */
  private async scrapeEventDetails(url: string): Promise<ScrapedEvent[]> {
    const page = await this.browser!.newPage();
    await page.setUserAgent(this.config.userAgent!);

    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.options.timeout,
      });

      await this.delay(2000);

      const html = await page.content();
      const $ = cheerio.load(html);

      // ==================== EXTRAIR INFORMAÇÕES COMUNS ====================

      // Título
      const title =
        $('h1.elementor-heading-title').first().text().trim() ||
        $('.entry-title').text().trim() ||
        $('h1').first().text().trim();

      if (!title) {
        console.warn('  ⚠️ Título não encontrado');
        return [];
      }

      // Descrição
      let description = '';
      $('.elementor-widget-text-editor, .elementor-text-editor').each(
        (_, elem) => {
          const text = $(elem).text().trim();
          if (text.length > 100 && text.length > description.length) {
            description = text;
          }
        },
      );

      // Tipo de evento
      let eventType = 'CONCERT';
      const textLower = `${title} ${description}`.toLowerCase();

      if (textLower.includes('ópera') || textLower.includes('opera')) {
        eventType = 'OPERA';
      } else if (textLower.includes('balé') || textLower.includes('dança')) {
        eventType = 'BALLET';
      } else if (
        textLower.includes('câmara') ||
        textLower.includes('chamber')
      ) {
        eventType = 'CHAMBER_MUSIC';
      } else if (textLower.includes('coral') || textLower.includes('coro')) {
        eventType = 'CHORAL';
      } else if (textLower.includes('recital')) {
        eventType = 'RECITAL';
      } else if (textLower.includes('festival')) {
        eventType = 'FESTIVAL';
      } else if (
        textLower.includes('workshop') ||
        textLower.includes('oficina')
      ) {
        eventType = 'WORKSHOP';
      } else if (
        textLower.includes('master class') ||
        textLower.includes('masterclass')
      ) {
        eventType = 'MASTERCLASS';
      }

      // Local
      let venueDetails = 'Theatro Municipal de São Paulo';
      const venueMatch = $('body')
        .text()
        .match(/(Praça das Artes|Central Técnica|Theatro Municipal)/i);
      if (venueMatch) {
        venueDetails = venueMatch[1];
      }

      // Imagem
      let imageUrl: string | null = null;
      const ogImage = $('meta[property="og:image"]').attr('content');
      const featuredImage = $(
        '.wp-post-image, .featured-image img, .elementor-post__thumbnail img',
      )
        .first()
        .attr('src');
      imageUrl = ogImage || featuredImage || null;

      // Informações de ingresso
      let ticketInfo: string | null = null;
      let ticketUrl = url;

      const fullText = $('body').text();

      if (
        fullText.includes('Gratuito') ||
        fullText.includes('gratuito') ||
        fullText.includes('Grátis')
      ) {
        ticketInfo = 'Entrada gratuita';
      } else if (fullText.includes('Evento Pago')) {
        ticketInfo = 'Evento pago';
      }

      const ticketButton = $(
        'a[href*="inti.com"], a[href*="sympla.com"], a[href*="ingresso"], a[href*="ticket"]',
      )
        .first()
        .attr('href');

      if (ticketButton && ticketButton !== url) {
        ticketUrl = ticketButton;
      }

      // Programa
      let program: string | null = null;
      const programSection = $('.programa, .repertorio, .program')
        .text()
        .trim();
      if (programSection && programSection.length > 50) {
        program = programSection;
      }

      // Detectar compositores
      const textForComposers = `${title} ${description} ${program || ''}`;
      const composerNames = extractComposerNames(textForComposers);

      // ==================== EXTRAIR TODAS AS DATAS E HORÁRIOS ====================

      const sessions: { date: Date; time: string }[] = [];

      // 1. Buscar DATA e HORÁRIO principais (primeira data)
      const mainDateElement = $('.jet-listing-dynamic-field__content')
        .filter((_, el) => {
          const parent = $(el).parent();
          return parent.find('.fa-calendar-alt').length > 0;
        })
        .first();

      const mainTimeElement = $('.jet-listing-dynamic-field__content')
        .filter((_, el) => {
          const parent = $(el).parent();
          return parent.find('.fa-clock').length > 0;
        })
        .first();

      const mainDateText = mainDateElement.text().trim();
      const mainTimeText = mainTimeElement.text().trim();

      if (mainDateText) {
        const mainDate = this.parsePortugueseDate(mainDateText);
        const mainTime = this.parseTime(mainTimeText);

        if (mainDate) {
          sessions.push({ date: mainDate, time: mainTime || '20:00' });
          console.log(
            `    📅 Sessão 1: ${mainDateText} às ${mainTime || '20:00'}`,
          );
        }
      }

      // 2. Buscar DATAS ADICIONAIS (dentro da lista "jet-listing-grid__items")
      $('.jet-listing-grid__item').each((index, item) => {
        const $item = $(item);

        const dateEl = $item
          .find('.jet-listing-dynamic-field__content')
          .filter((_, el) => {
            const parent = $(el).parent();
            return parent.find('.fa-calendar-alt').length > 0;
          })
          .first();

        const timeEl = $item
          .find('.jet-listing-dynamic-field__content')
          .filter((_, el) => {
            const parent = $(el).parent();
            return parent.find('.fa-clock').length > 0;
          })
          .first();

        const dateText = dateEl.text().trim();
        const timeText = timeEl.text().trim();

        if (dateText) {
          const additionalDate = this.parsePortugueseDate(dateText);
          const additionalTime = this.parseTime(timeText);

          if (additionalDate) {
            // Evitar duplicatas
            const isDuplicate = sessions.some(
              (s) => s.date.getTime() === additionalDate.getTime(),
            );

            if (!isDuplicate) {
              sessions.push({
                date: additionalDate,
                time: additionalTime || '20:00',
              });
              console.log(
                `    📅 Sessão ${sessions.length}: ${dateText} às ${additionalTime || '20:00'}`,
              );
            }
          }
        }
      });

      if (sessions.length === 0) {
        console.warn('  ⚠️ Nenhuma data encontrada');
        return [];
      }

      // ==================== CRIAR UM EVENTO PARA CADA SESSÃO ====================

      const events: ScrapedEvent[] = [];

      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        const sessionNumber = sessions.length > 1 ? ` (Sessão ${i + 1})` : '';

        const externalId = `theatro-municipal-${createSlug(title)}-${session.date.getTime()}`;

        events.push({
          title: `${title}${sessionNumber}`,
          slug: createSlug(`${title}-${session.date.toISOString()}`),
          description: description || title,
          type: eventType,
          startDate: session.date,
          startTime: session.time,
          endDate: null,
          endTime: null,
          venueDetails,
          ticketUrl,
          externalUrl: url,
          ticketInfo,
          externalId,
          imageUrl,
          composerNames,
          performers: [],
          program,
        });
      }

      console.log(`  ✅ ${title} - ${events.length} sessão(ões)`);

      return events;
    } catch (error) {
      console.error(`  ❌ Erro ao processar ${url}:`, error);
      return [];
    } finally {
      await page.close();
    }
  }

  /**
   * 🕐 PARSEAR HORÁRIO
   */
  private parseTime(text: string): string | null {
    if (!text) return null;

    const timeMatch = text.match(/(\d{1,2}):?(\d{2})/);
    if (timeMatch) {
      const [, hour, minute] = timeMatch;
      return `${hour.padStart(2, '0')}:${minute}`;
    }

    return null;
  }

  /**
   * 📅 PARSEAR DATA EM PORTUGUÊS
   */
  private parsePortugueseDate(text: string): Date | null {
    const dateRegex = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i;
    const match = text.match(dateRegex);

    if (!match) return null;

    const [, day, monthName, year] = match;

    const months: Record<string, number> = {
      janeiro: 0,
      fevereiro: 1,
      março: 2,
      abril: 3,
      maio: 4,
      junho: 5,
      julho: 6,
      agosto: 7,
      setembro: 8,
      outubro: 9,
      novembro: 10,
      dezembro: 11,
    };

    const monthIndex = months[monthName.toLowerCase()];

    if (monthIndex === undefined) {
      console.warn(`    ⚠️ Mês não reconhecido: ${monthName}`);
      return null;
    }

    return new Date(parseInt(year), monthIndex, parseInt(day));
  }

  /**
   * 📅 HELPERS
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  }
}
