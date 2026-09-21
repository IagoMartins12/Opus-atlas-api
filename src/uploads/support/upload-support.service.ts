import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppCacheService } from '../../common/cache/cache.service';
import { CacheNamespace, CacheTtl } from '../../common/cache/cache-keys';

const FORM_DATA_CACHE_KEY = `${CacheNamespace.EPOCHS}:uploads:form-data`;

export interface UploadFormData {
  epochs: Array<{ id: string; name: string }>;
  instruments: Array<{ id: string; name: string; category: string | null }>;
  roles: Array<{ id: string; name: string }>;
}

@Injectable()
export class UploadSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AppCacheService,
  ) {}

  /**
   * Listas que alimentam os formulários de contribuição.
   *
   * Épocas, instrumentos e papéis são dados quase estáticos: mudam raramente e
   * são pedidos em toda abertura de formulário. Servi-los do cache elimina três
   * consultas por carregamento.
   *
   * O legado tinha três rotas (`form-data`, `filter-data`, `available-epochs`)
   * devolvendo recortes sobrepostos das mesmas tabelas. Aqui é uma só.
   */
  async formData(): Promise<UploadFormData> {
    const cached = await this.cache.get<UploadFormData>(
      FORM_DATA_CACHE_KEY,
      '/uploads/form-data',
    );

    if (cached) {
      return cached;
    }

    const [epochs, instruments, roles] = await Promise.all([
      this.prisma.epoch.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.instrument.findMany({
        select: { id: true, name: true, category: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.role.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const response: UploadFormData = { epochs, instruments, roles };

    await this.cache.set(FORM_DATA_CACHE_KEY, response, CacheTtl.STATIC);

    return response;
  }
}
