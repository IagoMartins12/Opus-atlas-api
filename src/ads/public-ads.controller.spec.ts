import type { Request } from 'express';
import { PublicAdsController } from './public-ads.controller';
import { PublicAdsService } from './public-ads.service';

describe('PublicAdsController', () => {
  const service = {
    ads: jest.fn().mockResolvedValue({ ads: [] }),
    track: jest.fn().mockResolvedValue({ success: true }),
  };
  const controller = new PublicAdsController(
    service as unknown as PublicAdsService,
  );

  it('escolhe o anúncio pelo dispositivo do navegador', async () => {
    await controller.ads(
      {} as never,
      {
        headers: { 'user-agent': 'Mozilla/5.0 (iPhone; Mobile)' },
      } as unknown as Request,
    );

    expect(service.ads).toHaveBeenCalledWith({}, 'mobile');
  });

  it('conta o evento com quem vê, a origem e o contexto do pedido', async () => {
    await controller.track(
      { adId: 'a1', event: 'click' } as never,
      { sub: 'u1', isTeacher: true, isStudent: false } as never,
      {
        headers: { referer: 'https://opusatlas.com.br/x', 'user-agent': 'UA' },
        ip: '1.1.1.1',
      } as unknown as Request,
    );

    expect(service.track).toHaveBeenCalledWith(
      { adId: 'a1', event: 'click' },
      expect.objectContaining({
        userId: 'u1',
        isTeacher: true,
        isStudent: false,
        referrer: 'https://opusatlas.com.br/x',
      }),
    );
  });

  it('visitante sem login e sem origem', async () => {
    await controller.track(
      { adId: 'a1', event: 'impression' } as never,
      undefined,
      {
        headers: {},
      } as unknown as Request,
    );

    expect(service.track).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: undefined, referrer: undefined }),
    );
  });
});
