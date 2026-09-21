import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ExternalPageFetcher } from './external-page.fetcher';

const get = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn(() => ({ get })) },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axios = (jest.requireMock('axios') as { default: { create: jest.Mock } })
  .default;

const IMSLP =
  'https://imslp.org/wiki/Nocturnes,_Op.9_(Chopin,_Fr%C3%A9d%C3%A9ric)';

describe('ExternalPageFetcher', () => {
  let fetcher: ExternalPageFetcher;

  beforeEach(() => {
    get.mockReset();
    fetcher = new ExternalPageFetcher();
  });

  // Sem redirecionamento e com teto de tamanho: a URL é de quem chama.
  it('cliente sem redirecionamento, com teto de tempo e de tamanho', () => {
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRedirects: 0,
        timeout: 15_000,
        maxContentLength: 8 * 1024 * 1024,
      }),
    );
  });

  it('carrega HTML do IMSLP', async () => {
    get.mockResolvedValue({
      data: '<html><h1>Noturnos</h1></html>',
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    const page = await fetcher.load(IMSLP, 'imslp');

    expect(page.source).toBe('imslp');
    expect(page.$('h1').text()).toBe('Noturnos');
  });

  it('resposta que não é HTML é 502 com o tipo recebido', async () => {
    get.mockResolvedValue({
      data: '{}',
      headers: { 'content-type': 'application/json' },
    });
    await expect(fetcher.load(IMSLP)).rejects.toThrow('application/json');

    get.mockResolvedValue({ data: 'x', headers: {} });
    await expect(fetcher.load(IMSLP)).rejects.toThrow('sem tipo');
  });

  it('falha de rede vira 502 sem vazar o detalhe', async () => {
    get.mockRejectedValue(new Error('ECONNRESET'));

    const error = await fetcher.load(IMSLP).catch((e) => e);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect(error.message).not.toContain('ECONNRESET');
  });

  it('host fora da lista é recusado antes de qualquer requisição', async () => {
    await expect(
      fetcher.load('http://169.254.169.254/latest/meta-data'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(get).not.toHaveBeenCalled();
  });

  it('JSON: texto é convertido; objeto passa; falha é 502', async () => {
    get.mockResolvedValueOnce({ data: '{"a":1}', headers: {} });
    await expect(fetcher.loadJson<{ a: number }>(IMSLP)).resolves.toMatchObject(
      { data: { a: 1 } },
    );

    get.mockResolvedValueOnce({ data: { b: 2 }, headers: {} });
    await expect(fetcher.loadJson(IMSLP)).resolves.toMatchObject({
      data: { b: 2 },
    });

    get.mockResolvedValueOnce({ data: '{quebrado', headers: {} });
    await expect(fetcher.loadJson(IMSLP)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
