import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { BaseScraper, ScraperConfig } from '../base/base-scraper';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ScrapedEvent,
  ScraperResponse,
} from '../../common/interfaces/scraped-event.interface';
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
    if (!this.browser) {
      console.log('🚀 Iniciando Puppeteer...');

      const executablePath = await this.findChrome();

      this.browser = await puppeteer.launch({
        executablePath,
        headless: this.options.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
        ],
      });

      console.log('✅ Browser iniciado');
    }
  }

  /**
   * 🔍 ENCONTRAR CHROME
   */
  private async findChrome(): Promise<string> {
    const possiblePaths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];

    for (const path of possiblePaths) {
      if (fs.existsSync(path)) {
        console.log(`✅ Chrome encontrado em: ${path}`);
        return path;
      }
    }

    throw new Error(
      'Chrome não encontrado. Por favor, instale o Google Chrome ou execute: npx puppeteer browsers install chrome',
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
  async scrapeEvents(): Promise<ScrapedEvent[]> {
    try {
      await this.initBrowser();

      const startDateStr = this.formatDate(this.options.startDate);
      const endDateStr = this.formatDate(this.options.endDate);

      const baseUrl = `https://theatromunicipal.org.br/programacao/?jsf=jet-engine:q1&meta=data_inicial_timestamp!date:${startDateStr}-${endDateStr}`;

      console.log(`🎭 Buscando eventos do Theatro Municipal...`);
      console.log(`📅 Período: ${startDateStr} a ${endDateStr}`);

      const page = await this.browser!.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(this.config.userAgent!);

      await page.goto(baseUrl, {
        waitUntil: 'networkidle2',
        timeout: this.options.timeout,
      });

      // Aguardar carregamento dos cards
      await page.waitForSelector('.jet-listing-grid__items', {
        timeout: 10000,
      });

      await this.delay(3000);

      let allEventUrls: string[] = [];
      let currentPage = 1;
      let hasNextPage = true;

      // ==================== COLETAR URLS DE TODOS OS EVENTOS (COM PAGINAÇÃO) ====================
      while (hasNextPage) {
        console.log(`📄 Coletando URLs da página ${currentPage}...`);

        // Buscar links corretos
        const eventUrls = await page.evaluate(() => {
          const urls: string[] = [];

          // Procurar por todos os links dentro dos items
          const items = document.querySelectorAll('.jet-listing-grid__item');

          items.forEach((item) => {
            // Buscar link do título (h3 > a)
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

        // Verificar se existe botão "Ver mais eventos"
        const loadMoreButton = await page.$('#ver-mais-eventos');

        if (loadMoreButton) {
          try {
            console.log(`  ➡️ Clicando em "Ver mais eventos"...`);

            await loadMoreButton.click();

            await this.delay(3000);

            // Verificar se novos eventos foram carregados
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

        // Limite de segurança
        if (currentPage > 10) {
          console.log(`  ⚠️ Limite de páginas atingido`);
          break;
        }
      }

      await page.close();

      // Remover duplicatas
      allEventUrls = [...new Set(allEventUrls)];
      console.log(
        `📊 Total de ${allEventUrls.length} eventos únicos encontrados`,
      );

      // ==================== SCRAPE DETALHES DE CADA EVENTO ====================
      const events: ScrapedEvent[] = [];

      for (let i = 0; i < allEventUrls.length; i++) {
        const url = allEventUrls[i];
        console.log(`\n[${i + 1}/${allEventUrls.length}] Processando: ${url}`);

        try {
          const event = await this.scrapeEventDetails(url);
          if (event) {
            events.push(event);
            this.state.eventsScraped++;
            console.log(`  ✅ ${event.title}`);
          } else {
            console.log(`  ⚠️ Evento pulado (dados incompletos)`);
          }
        } catch (error) {
          console.error(`  ❌ Erro ao processar evento:`, error);
          this.state.errors.push(`Failed to scrape ${url}: ${error}`);
        }

        // Delay entre requests
        await this.delay(1500);
      }

      this.state.eventsFound = allEventUrls.length;

      console.log(
        `\n✅ Scraping concluído: ${events.length} eventos processados`,
      );
      return events;
    } catch (error) {
      console.error('❌ Erro no scraping:', error);
      throw error;
    }
  }

  /**
   * 🎭 SCRAPE DETALHES DO EVENTO
   */
  private async scrapeEventDetails(url: string): Promise<ScrapedEvent | null> {
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

      // ==================== EXTRAIR INFORMAÇÕES ====================

      // Título
      const title =
        $('h1.elementor-heading-title').first().text().trim() ||
        $('.entry-title').text().trim() ||
        $('h1').first().text().trim();

      if (!title) {
        console.warn('  ⚠️ Título não encontrado');
        return null;
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

      // Data e horário
      let startDate: Date | null = null;
      let startTime: string | null = null;

      // Buscar data e horário em todo o HTML
      const dateRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
      const timeRegex = /(\d{1,2})[h:](\d{2})/i;

      const fullText = $('body').text();
      const dateMatch = fullText.match(dateRegex);
      if (dateMatch) {
        const [, day, month, year] = dateMatch;
        startDate = new Date(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
        );
      }

      const timeMatch = fullText.match(timeRegex);
      if (timeMatch) {
        const [, hour, minute] = timeMatch;
        startTime = `${hour.padStart(2, '0')}:${minute}`;
      }

      if (!startDate) {
        console.warn('  ⚠️ Data não encontrada');
        return null;
      }

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
      const venueMatch = fullText.match(
        /(Praça das Artes|Central Técnica|Theatro Municipal)/i,
      );
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
      let ticketUrl = url; // Padrão: página do evento

      // Verificar se é gratuito
      if (
        fullText.includes('Gratuito') ||
        fullText.includes('gratuito') ||
        fullText.includes('Grátis')
      ) {
        ticketInfo = 'Entrada gratuita';
      } else if (fullText.includes('Evento Pago')) {
        ticketInfo = 'Evento pago';
      }

      // Buscar URL de compra de ingressos (Inti/Sympla/etc)
      const ticketButton = $(
        'a[href*="inti.com"], a[href*="sympla.com"], a[href*="ingresso"], a[href*="ticket"]',
      )
        .first()
        .attr('href');

      if (ticketButton && ticketButton !== url) {
        ticketUrl = ticketButton;
        console.log(`    🎫 Ticket URL: ${ticketUrl}`);
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

      // External ID
      const externalId = `theatro-municipal-${createSlug(title)}-${startDate.getTime()}`;

      return {
        title,
        slug: createSlug(title),
        description: description || title,
        type: eventType,
        startDate,
        startTime,
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
      };
    } catch (error) {
      console.error(`  ❌ Erro ao processar ${url}:`, error);
      return null;
    } finally {
      await page.close();
    }
  }

  /**
   * ✅ MÉTODO COMPLETO: Scrape + Verificação de Duplicatas
   */
  async scrapeAndCheckDuplicates(): Promise<ScraperResponse> {
    const startTime = Date.now();

    try {
      const scrapedEvents = await this.scrapeEvents();

      const allEvents: ScrapedEvent[] = [];
      let duplicates = 0;

      for (const event of scrapedEvents) {
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
    }
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
