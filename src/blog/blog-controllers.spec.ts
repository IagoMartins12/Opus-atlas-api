import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { ArticlesAdminController } from './articles/articles-admin.controller';
import { ArticlesController } from './articles/articles.controller';
import {
  CalendarController,
  EventsController,
  VenuesController,
} from './calendar/calendar.controller';
import { CategoriesAdminController } from './categories/categories-admin.controller';
import { CommentsController } from './comments/comments.controller';
import { InteractionsController } from './interactions/interactions.controller';
import { BlogMediaController } from './media/blog-media.controller';
import { TagsAdminController } from './tags/tags-admin.controller';
import { TagsController } from './tags/tags.controller';
import { TtsController } from './tts/tts.controller';

const user: AccessTokenPayload = {
  sub: 'u1',
  email: 'a@x.com',
  role: 1,
  isTeacher: false,
  isStudent: false,
  type: 'access',
};
const request = {
  headers: { 'user-agent': 'UA' },
  ip: '1.1.1.1',
} as unknown as Request;
const file = {
  buffer: Buffer.from('x'),
  originalname: 'a.jpg',
  size: 1,
} as Express.Multer.File;

/** Métodos que devolvem o próprio nome — basta para conferir a delegação. */
function echoMock(...methods: string[]): Record<string, jest.Mock> {
  return Object.fromEntries(
    methods.map((m) => [m, jest.fn().mockResolvedValue(m)]),
  );
}
const as = <T>(value: unknown) => value as T;

describe('artigos', () => {
  it('leitura pública passa o usuário quando há', async () => {
    const service = echoMock('findAll', 'findFeatured', 'findOne');
    const controller = new ArticlesController(as(service));

    await controller.findAll(user, {} as never);
    await controller.findAll(undefined, {} as never);
    await controller.findFeatured();
    await controller.findOne(user, 'a1');

    expect(service.findAll.mock.calls[0][1]).toEqual({ sub: 'u1', role: 1 });
    expect(service.findAll.mock.calls[1][1]).toBeUndefined();
    expect(service.findOne).toHaveBeenCalledWith('a1', { sub: 'u1', role: 1 });
  });

  it('administração: escrita, publicação, destaque e versões', async () => {
    const writer = echoMock(
      'create',
      'update',
      'remove',
      'duplicate',
      'listVersions',
      'getVersion',
      'restore',
    );
    const publishing = echoMock(
      'reorderFeatured',
      'publish',
      'approve',
      'feature',
    );
    const controller = new ArticlesAdminController(as(writer), as(publishing));

    await controller.create({} as never, user);
    await controller.reorderFeatured({ articles: [] } as never);
    await controller.update('a1', {} as never, user);
    await controller.remove('a1');
    await controller.publish('a1', {
      action: 'schedule',
      scheduledFor: '2026-10-01',
    } as never);
    await controller.approve('a1');
    await controller.duplicate('a1', user);
    await controller.feature('a1', {
      isFeatured: true,
      featuredOrder: 2,
    } as never);
    await controller.versions('a1');
    await controller.version('a1', 3);
    await controller.restore('a1', 3, user);

    expect(writer.create).toHaveBeenCalledWith({}, 'u1');
    expect(publishing.publish).toHaveBeenCalledWith(
      'a1',
      'schedule',
      '2026-10-01',
    );
    expect(publishing.feature).toHaveBeenCalledWith('a1', true, 2);
    expect(writer.restore).toHaveBeenCalledWith('a1', 3, 'u1');
  });
});

describe('agenda, eventos e locais', () => {
  it('agenda e importação', async () => {
    const calendar = echoMock('calendar');
    const importer = echoMock('checkDuplicates', 'bulkInsert');
    const controller = new CalendarController(as(calendar), as(importer));

    await controller.get({} as never, undefined);
    await controller.checkDuplicates({ events: [] } as never);
    await controller.bulkInsert({ scraperId: 'osesp', events: [] } as never);

    expect(importer.bulkInsert).toHaveBeenCalledWith('osesp', []);
  });

  it('eventos e locais', async () => {
    const events = echoMock(
      'createEvent',
      'getEvent',
      'updateEvent',
      'deleteEvent',
      'createVenue',
      'getVenue',
      'updateVenue',
      'deleteVenue',
    );
    const eventsController = new EventsController(as(events));
    const venues = new VenuesController(as(events));

    await eventsController.create({} as never, user);
    await eventsController.get('e1', undefined);
    await eventsController.update('e1', {} as never, user);
    await eventsController.remove('e1');
    await venues.create({} as never);
    await venues.get('v1');
    await venues.update('v1', {} as never);
    await venues.remove('v1');

    expect(events.createEvent).toHaveBeenCalledWith({}, 'u1');
    expect(events.updateEvent).toHaveBeenCalledWith('e1', {}, 'u1');
    expect(events.deleteVenue).toHaveBeenCalledWith('v1');
  });
});

describe('categorias e tags', () => {
  it('categorias: CRUD e imagem (sem arquivo é 400)', async () => {
    const service = echoMock(
      'list',
      'create',
      'reorder',
      'update',
      'remove',
      'uploadImage',
      'removeImage',
    );
    const controller = new CategoriesAdminController(as(service));

    await controller.list();
    await controller.create({} as never);
    await controller.reorder({ categories: [] } as never);
    await controller.update('c1', {} as never);
    await controller.remove('c1');
    await controller.removeImage('c1');
    await controller.uploadImage('c1', file, user);

    expect(service.uploadImage).toHaveBeenCalledWith(
      'c1',
      { buffer: file.buffer, originalName: 'a.jpg', size: 1 },
      'u1',
    );
    expect(() => controller.uploadImage('c1', undefined, user)).toThrow(
      BadRequestException,
    );
  });

  it('tags: públicas e administração', async () => {
    const service = echoMock('findAll', 'findBySlug', 'findArticles');
    const admin = echoMock('list', 'create', 'update', 'remove');
    const controller = new TagsController(as(service));
    const adminController = new TagsAdminController(as(admin));

    await controller.findAll({} as never);
    await controller.findBySlug('barroco');
    await controller.findArticles('barroco', {} as never);
    await adminController.list();
    await adminController.create({} as never);
    await adminController.update('t1', {} as never);
    await adminController.remove('t1');

    expect(service.findArticles).toHaveBeenCalledWith('barroco', {});
    expect(admin.remove).toHaveBeenCalledWith('t1');
  });
});

describe('comentários e interações', () => {
  it('comentários: lista com ordenação padrão, escrita, curtida e denúncia', async () => {
    const service = echoMock(
      'list',
      'create',
      'update',
      'remove',
      'like',
      'unlike',
      'report',
    );
    const controller = new CommentsController(as(service));

    await controller.list('a1', {} as never, undefined);
    await controller.list('a1', { sortBy: 'popular' } as never, user);
    await controller.create('a1', {} as never, user);
    await controller.update('c1', {} as never, user);
    await controller.remove('c1', user);
    await controller.like('c1', user);
    await controller.unlike('c1', user);
    await controller.report('c1', {} as never, user, request);

    expect(service.list.mock.calls[0]).toEqual(['a1', 'newest', undefined]);
    expect(service.list.mock.calls[1]).toEqual([
      'a1',
      'popular',
      { sub: 'u1', role: 1 },
    ]);
    expect(service.remove).toHaveBeenCalledWith('c1', { sub: 'u1', role: 1 });
  });

  it('curtir, guardar, e registrar leitura com o contexto do pedido', async () => {
    const service = echoMock(
      'summary',
      'like',
      'unlike',
      'bookmark',
      'unbookmark',
      'myLikes',
      'myBookmarks',
      'registerView',
      'registerRead',
    );
    const controller = new InteractionsController(as(service));

    await controller.summary('a1', undefined);
    await controller.like('a1', user);
    await controller.unlike('a1', user);
    await controller.bookmark('a1', { notes: 'ler depois' } as never, user);
    await controller.unbookmark('a1', user);
    await controller.myLikes({} as never, user);
    await controller.myBookmarks({} as never, user);
    await controller.view('a1', undefined, request);
    await controller.read('a1', { readTime: 90 } as never, user, request);

    expect(service.bookmark).toHaveBeenCalledWith('a1', 'u1', 'ler depois');
    expect(service.registerView).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ userId: undefined }),
    );
    expect(service.registerRead).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ userId: 'u1' }),
      90,
    );
  });
});

describe('mídia e voz', () => {
  it('mídia: envio exige arquivo; lista, cria, edita e apaga', async () => {
    const service = echoMock(
      'upload',
      'removeUpload',
      'listArticleMedia',
      'createMedia',
      'updateMedia',
      'deleteMedia',
    );
    const controller = new BlogMediaController(as(service));

    expect(() => controller.upload(undefined, {} as never, user)).toThrow(
      BadRequestException,
    );
    await controller.upload(
      file,
      { folder: 'images', articleId: 'a1' } as never,
      user,
    );
    await controller.removeUpload({ url: 'https://cdn/x' } as never);
    await controller.list('a1', {} as never, undefined);
    await controller.create('a1', {} as never);
    await controller.update('m1', {} as never);
    await controller.remove('m1');

    expect(service.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'images',
        articleId: 'a1',
        userId: 'u1',
      }),
    );
    expect(service.removeUpload).toHaveBeenCalledWith('https://cdn/x');
  });

  it('texto para voz', async () => {
    const service = echoMock('audio', 'remove');
    const controller = new TtsController(as(service));

    await controller.audio({} as never, user);
    await controller.remove({ articleId: 'a1' } as never);

    expect(service.remove).toHaveBeenCalledWith('a1');
  });
});
