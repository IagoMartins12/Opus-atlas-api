import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { errorMessage } from '../../common/utils/error.util';

export interface ArquivoDeBackup {
  /** Caminho dentro do bucket, que é também o identificador. */
  key: string;
  sizeBytes: number;
  criadoEm: Date;
}

/**
 * O bucket dos backups, no Cloudflare R2.
 *
 * **Por que não o Cloudinary**, que é onde vivem os arquivos da plataforma:
 * ele entrega por URL pública e limita arquivo bruto a 10–100 MB conforme o
 * plano. Um backup tem e-mail, hash de senha e histórico de pagamento de todo
 * mundo, e o dump passa desses limites. São dois motivos independentes, e cada
 * um sozinho já bastaria.
 *
 * Nada aqui é obrigatório para a aplicação subir: sem configuração, a tarefa
 * de backup recusa rodar e diz o que falta.
 */
@Injectable()
export class BackupStorageService {
  private readonly logger = new Logger(BackupStorageService.name);
  private cliente: S3Client | null = null;

  constructor(private readonly config: ConfigService) {}

  /** O que falta para o backup funcionar, em texto para a tela. */
  get configurado(): boolean {
    return (
      Boolean(this.config.get<string>('backup.r2AccountId')) &&
      Boolean(this.config.get<string>('backup.r2AccessKeyId')) &&
      Boolean(this.config.get<string>('backup.r2SecretAccessKey')) &&
      Boolean(this.config.get<string>('backup.r2Bucket'))
    );
  }

  get bucket(): string {
    return this.config.get<string>('backup.r2Bucket') ?? '';
  }

  get prefixo(): string {
    // O padrão por ambiente mora em `configuration.ts`; este é só a rede de
    // segurança de quem monta o serviço sem ela (os scripts, os testes).
    return (
      this.config.get<string>('backup.prefix') ??
      `backups/${process.env.NODE_ENV ?? 'development'}`
    );
  }

  private get s3(): S3Client {
    if (this.cliente) return this.cliente;

    if (!this.configurado) {
      throw new Error(
        'Armazenamento de backup não configurado: defina BACKUP_R2_ACCOUNT_ID, ' +
          'BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY e BACKUP_R2_BUCKET.',
      );
    }

    const accountId = this.config.get<string>('backup.r2AccountId');

    this.cliente = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.config.get<string>('backup.r2AccessKeyId') ?? '',
        secretAccessKey:
          this.config.get<string>('backup.r2SecretAccessKey') ?? '',
      },
    });

    return this.cliente;
  }

  async enviar(key: string, corpo: Buffer): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: corpo,
        ContentType: 'application/gzip',
      }),
    );

    this.logger.log(`Backup enviado: ${key} (${corpo.byteLength} bytes)`);
  }

  async baixar(key: string): Promise<Buffer> {
    const resposta = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    const bytes = await resposta.Body?.transformToByteArray();

    if (!bytes) {
      throw new Error(`O objeto ${key} voltou vazio do bucket.`);
    }

    return Buffer.from(bytes);
  }

  async listar(): Promise<ArquivoDeBackup[]> {
    const resposta = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${this.prefixo}/`,
      }),
    );

    return (resposta.Contents ?? [])
      .filter((objeto) => objeto.Key && objeto.Key.endsWith('.json.gz'))
      .map((objeto) => ({
        key: objeto.Key as string,
        sizeBytes: objeto.Size ?? 0,
        criadoEm: objeto.LastModified ?? new Date(0),
      }))
      .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
  }

  async apagar(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    this.logger.log(`Backup antigo removido: ${key}`);
  }

  /**
   * Link temporário para baixar um backup.
   *
   * O bucket é privado e continua privado: o link vale por uma hora e é
   * assinado com a credencial do servidor. Tornar o objeto público para
   * facilitar o download seria publicar a base inteira.
   */
  async linkTemporario(key: string, segundos = 3600): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: segundos },
    );
  }

  /** Diz o que falta, para a tela explicar em vez de só falhar. */
  get diagnostico(): string | null {
    if (this.configurado) return null;

    const faltando = [
      ['BACKUP_R2_ACCOUNT_ID', 'backup.r2AccountId'],
      ['BACKUP_R2_ACCESS_KEY_ID', 'backup.r2AccessKeyId'],
      ['BACKUP_R2_SECRET_ACCESS_KEY', 'backup.r2SecretAccessKey'],
      ['BACKUP_R2_BUCKET', 'backup.r2Bucket'],
    ]
      .filter(([, chave]) => !this.config.get<string>(chave))
      .map(([nome]) => nome);

    return `Armazenamento de backup não configurado. Falta: ${faltando.join(', ')}.`;
  }

  /** Só para o teste: a mensagem de erro do SDK, sem vazar credencial. */
  protected descreverErro(erro: unknown): string {
    return errorMessage(erro);
  }
}
