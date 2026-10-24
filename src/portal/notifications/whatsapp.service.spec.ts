import { ConfigService } from '@nestjs/config';
import { normalizePhone, WhatsAppService } from './whatsapp.service';

const config = (wa: Record<string, string | undefined>) =>
  ({ get: () => wa }) as unknown as ConfigService;

describe('WhatsAppService', () => {
  it('sem token ou número, o canal fica desligado', async () => {
    const service = new WhatsAppService(config({}), jest.fn());
    expect(service.enabled).toBe(false);
    await expect(
      service.sendTemplate({ to: '11912345678', template: 'x', params: [] }),
    ).resolves.toMatchObject({ delivered: false, permanent: true });
  });

  it('envia o modelo pela Cloud API, com o número em E.164 e os parâmetros limpos', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true });
    const service = new WhatsAppService(
      config({ token: 'tok', phoneNumberId: '123', apiVersion: 'v23.0' }),
      fetchFn as unknown as typeof fetch,
    );

    await expect(
      service.sendTemplate({
        to: '+55 (11) 91234-5678',
        template: 'opus_aula_lembrete',
        params: ['Aula\\namanhã', ''],
      }),
    ).resolves.toEqual({ delivered: true });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/123/messages');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5511912345678',
      type: 'template',
      template: {
        name: 'opus_aula_lembrete',
        language: { code: 'pt_BR' },
      },
    });
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Aula\\namanhã'.replace(/\s+/g, ' ') },
      { type: 'text', text: '-' },
    ]);
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('erro 4xx da Meta é permanente; 429 e 5xx não', async () => {
    const reply = (status: number) =>
      jest.fn().mockResolvedValue({
        ok: false,
        status,
        json: () => Promise.resolve({ error: { message: 'falhou' } }),
      });
    const make = (fetchFn: jest.Mock) =>
      new WhatsAppService(
        config({ token: 't', phoneNumberId: '1' }),
        fetchFn as unknown as typeof fetch,
      );
    const send = (s: WhatsAppService) =>
      s.sendTemplate({ to: '11912345678', template: 'x', params: ['a'] });

    await expect(send(make(reply(400)))).resolves.toMatchObject({
      permanent: true,
      error: 'falhou',
    });
    await expect(send(make(reply(429)))).resolves.toMatchObject({
      permanent: false,
    });
    await expect(send(make(reply(503)))).resolves.toMatchObject({
      permanent: false,
    });
  });
});

describe('normalizePhone', () => {
  it('celular e fixo brasileiros ganham o 55; com DDI fica como está', () => {
    expect(normalizePhone('(11) 91234-5678')).toBe('5511912345678');
    expect(normalizePhone('1134567890')).toBe('551134567890');
    expect(normalizePhone('+1 415 555 0100')).toBe('14155550100');
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});
