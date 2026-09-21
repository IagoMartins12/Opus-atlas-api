import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CloudinaryService,
  toCloudinaryResourceType,
} from './cloudinary.service';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: { upload_stream: jest.fn(), destroy: jest.fn() },
    utils: { api_sign_request: jest.fn().mockReturnValue('assinatura') },
    api: { resource: jest.fn(), resources: jest.fn() },
    url: jest.fn().mockReturnValue('https://res.cloudinary.com/x'),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { v2: cloudinary } = jest.requireMock('cloudinary') as {
  v2: {
    config: jest.Mock;
    uploader: { upload_stream: jest.Mock; destroy: jest.Mock };
    utils: { api_sign_request: jest.Mock };
    api: { resource: jest.Mock; resources: jest.Mock };
    url: jest.Mock;
  };
};

const credentials = {
  'storage.cloudName': 'opus',
  'storage.apiKey': 'key',
  'storage.apiSecret': 'secret',
};

function serviceWith(values: Record<string, string | undefined> = credentials) {
  const service = new CloudinaryService({
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  } as unknown as ConfigService);
  service.onModuleInit();
  return service;
}

describe('CloudinaryService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('traduz o tipo do schema para o do Cloudinary', () => {
    expect(toCloudinaryResourceType('IMAGE')).toBe('image');
    expect(toCloudinaryResourceType('VIDEO')).toBe('video');
    expect(toCloudinaryResourceType('RAW')).toBe('raw');
  });

  it('sem credenciais fica desligado, e toda operação recusa', async () => {
    const service = serviceWith({});

    expect(service.isConfigured()).toBe(false);
    expect(cloudinary.config).not.toHaveBeenCalled();
    await expect(
      service.uploadBuffer(Buffer.from('x'), {
        folder: 'f',
        publicId: 'p',
        resourceType: 'IMAGE',
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(() =>
      service.createSignedUpload({
        folder: 'f',
        publicId: 'p',
        resourceType: 'IMAGE',
      }),
    ).toThrow('não configurado');
  });

  describe('com credenciais', () => {
    let service: CloudinaryService;

    beforeEach(() => {
      service = serviceWith();
    });

    it('configura com HTTPS', () => {
      expect(service.isConfigured()).toBe(true);
      expect(cloudinary.config).toHaveBeenCalledWith({
        cloud_name: 'opus',
        api_key: 'key',
        api_secret: 'secret',
        secure: true,
      });
    });

    it('envia o buffer sem usar o nome do arquivo do usuário', async () => {
      cloudinary.uploader.upload_stream.mockImplementation(
        (_options, callback) => ({
          end: () =>
            callback(undefined, {
              public_id: 'opus/p',
              secure_url: 'https://cdn/p.jpg',
              format: 'jpg',
              bytes: 10,
              width: 100,
              height: 50,
              resource_type: 'image',
            }),
        }),
      );

      const asset = await service.uploadBuffer(Buffer.from('x'), {
        folder: 'opus/development/perfil',
        publicId: 'p',
        resourceType: 'IMAGE',
      });

      expect(cloudinary.uploader.upload_stream.mock.calls[0][0]).toMatchObject({
        use_filename: false,
        unique_filename: false,
        resource_type: 'image',
      });
      expect(asset).toEqual({
        publicId: 'opus/p',
        secureUrl: 'https://cdn/p.jpg',
        format: 'jpg',
        bytes: 10,
        width: 100,
        height: 50,
        duration: undefined,
        resourceType: 'image',
      });
    });

    it('erro ou resposta vazia no envio vira 500 sem vazar detalhe', async () => {
      cloudinary.uploader.upload_stream.mockImplementation(
        (_options, callback) => ({
          end: () => callback({ message: 'cota' }, undefined),
        }),
      );
      await expect(
        service.uploadBuffer(Buffer.from('x'), {
          folder: 'f',
          publicId: 'p',
          resourceType: 'RAW',
        }),
      ).rejects.toThrow('Falha ao enviar o arquivo');

      cloudinary.uploader.upload_stream.mockImplementation(
        (_options, callback) => ({
          end: () => callback(undefined, undefined),
        }),
      );
      await expect(
        service.uploadBuffer(Buffer.from('x'), {
          folder: 'f',
          publicId: 'p',
          resourceType: 'RAW',
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    // O segredo nunca sai do servidor: vai só a assinatura do destino.
    it('assina só pasta, id, instante e tags', () => {
      const signed = service.createSignedUpload({
        folder: 'opus/f',
        publicId: 'p',
        resourceType: 'VIDEO',
        tags: ['a', 'b'],
      });

      expect(cloudinary.utils.api_sign_request).toHaveBeenCalledWith(
        {
          folder: 'opus/f',
          public_id: 'p',
          timestamp: expect.any(Number),
          tags: 'a,b',
        },
        'secret',
      );
      expect(signed).toMatchObject({
        signature: 'assinatura',
        apiKey: 'key',
        uploadUrl: 'https://api.cloudinary.com/v1_1/opus/video/upload',
        // Assinadas, então voltam para o cliente reenviar.
        tags: 'a,b',
      });
      expect(signed).not.toHaveProperty('apiSecret');
    });

    it('consulta: encontrado, inexistente e erro viram asset ou null', async () => {
      cloudinary.api.resource.mockResolvedValueOnce({
        public_id: 'p',
        secure_url: 'u',
      });
      await expect(service.getAsset('p', 'IMAGE')).resolves.toMatchObject({
        publicId: 'p',
        resourceType: 'image',
      });

      cloudinary.api.resource.mockRejectedValueOnce(
        new Error('Resource not found'),
      );
      await expect(service.getAsset('x', 'IMAGE')).resolves.toBeNull();

      cloudinary.api.resource.mockRejectedValueOnce(new Error('timeout'));
      await expect(service.getAsset('x', 'IMAGE')).resolves.toBeNull();
    });

    it('remover: "not found" também é sucesso; erro é falso', async () => {
      cloudinary.uploader.destroy.mockResolvedValueOnce({ result: 'ok' });
      await expect(service.deleteAsset('p', 'IMAGE')).resolves.toBe(true);

      cloudinary.uploader.destroy.mockResolvedValueOnce({
        result: 'not found',
      });
      await expect(service.deleteAsset('p', 'IMAGE')).resolves.toBe(true);

      cloudinary.uploader.destroy.mockResolvedValueOnce({ result: 'error' });
      await expect(service.deleteAsset('p', 'IMAGE')).resolves.toBe(false);

      cloudinary.uploader.destroy.mockRejectedValueOnce(new Error('rede'));
      await expect(service.deleteAsset('p', 'IMAGE')).resolves.toBe(false);
    });

    it('lista por prefixo com cursor', async () => {
      cloudinary.api.resources.mockResolvedValueOnce({
        resources: [{ public_id: 'a' }, { public_id: 'b' }],
        next_cursor: 'c2',
      });
      await expect(
        service.listByPrefix('opus/', 'IMAGE', 'c1'),
      ).resolves.toEqual({
        publicIds: ['a', 'b'],
        nextCursor: 'c2',
      });

      cloudinary.api.resources.mockResolvedValueOnce({});
      await expect(service.listByPrefix('opus/', 'RAW')).resolves.toEqual({
        publicIds: [],
        nextCursor: undefined,
      });
    });

    it('URL derivada com qualidade e corte padrão', () => {
      service.buildUrl('p', 'IMAGE');
      expect(cloudinary.url).toHaveBeenCalledWith(
        'p',
        expect.objectContaining({ quality: 'auto', crop: 'limit' }),
      );

      service.buildUrl('p', 'IMAGE', {
        width: 200,
        quality: '80',
        crop: 'fill',
      });
      expect(cloudinary.url).toHaveBeenLastCalledWith(
        'p',
        expect.objectContaining({ width: 200, quality: '80', crop: 'fill' }),
      );
    });
  });
});
