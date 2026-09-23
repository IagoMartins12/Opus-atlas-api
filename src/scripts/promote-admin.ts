import { PrismaClient } from '@prisma/client';
import { errorMessage } from '../common/utils/error.util';

/**
 * Promove (ou rebaixa) uma conta a administrador, pelo e-mail.
 *
 * **Por que existe.** Não há como criar o primeiro administrador pelo produto:
 * o cadastro sempre nasce com `role: 0`, e as rotas que mudam papel exigem um
 * administrador já logado. Ovo e galinha — em homologação, num banco semeado
 * (onde os usuários importados vêm anonimizados e sem papel), e no primeiro
 * dia de produção, alguém tem de abrir o banco. Este script é esse alguém,
 * com travas e registro.
 *
 * **Os papéis** (`User.role`, lido pelo `RolesGuard`):
 *
 * | Nível | Nome | O que abre |
 * |---|---|---|
 * | 0 | `user` | nada de administrativo |
 * | 1 | `admin` | as rotas `@Roles('ADMIN')` — o painel |
 * | 2 | `super` | idem, e o que exigir `SUPER_ADMIN` |
 *
 * O padrão é `admin`: o painel inteiro abre com nível 1, e dar 2 sem precisar
 * é ampliar acesso à toa.
 *
 * **As travas**, porque isto dá poder sobre o sistema:
 *
 * - `--email` é obrigatório e tem de existir: e-mail que não casa não cria
 *   conta, falha;
 * - `--confirmar <nome-do-banco>` tem de repetir o banco de destino, como no
 *   `db:restore` — quem digita o nome sabe em que ambiente está promovendo;
 * - a mudança fica em `admin_audit_logs` com `action: "user.role.set"` e o
 *   aviso de que veio por script, sem ator.
 *
 * **Depois de promover, a pessoa precisa entrar de novo.** O papel viaja
 * dentro do token de acesso; o token que ela já tem continua dizendo `role: 0`
 * até expirar (15 min) ou até um novo login.
 *
 * Uso:  npm run admin:promote:hml -- --email voce@exemplo.com --confirmar opus-hml
 *       npm run admin:promote:prd -- --email voce@exemplo.com --confirmar opus --nivel super
 *       …                          --nivel user      (rebaixa)
 */

export const NIVEIS: Record<string, number> = {
  user: 0,
  admin: 1,
  super: 2,
};

export function nomeDoNivel(nivel: number): string {
  return (
    Object.entries(NIVEIS).find(([, valor]) => valor === nivel)?.[0] ??
    `desconhecido (${nivel})`
  );
}

/** Nome do banco no fim da URL de conexão, sem a querystring. */
export function nomeDoBanco(url: string): string {
  const caminho = url.split('?')[0];
  const nome = caminho.slice(caminho.lastIndexOf('/') + 1);
  return nome || '';
}

export interface Argumentos {
  email: string;
  nivel: number;
  confirmar: string;
}

export function lerArgumentos(argv: string[]): Argumentos {
  const valor = (nome: string): string | undefined => {
    const i = argv.indexOf(`--${nome}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const email = valor('email')?.trim().toLowerCase();
  if (!email) {
    throw new Error('Faltou --email <endereço da conta>');
  }

  const confirmar = valor('confirmar')?.trim();
  if (!confirmar) {
    throw new Error(
      'Faltou --confirmar <nome-do-banco>: repita o banco onde a promoção deve acontecer',
    );
  }

  const nomeNivel = (valor('nivel') ?? 'admin').trim().toLowerCase();
  if (!(nomeNivel in NIVEIS)) {
    throw new Error(
      `--nivel inválido: "${nomeNivel}". Use ${Object.keys(NIVEIS).join(', ')}`,
    );
  }

  return { email, nivel: NIVEIS[nomeNivel], confirmar };
}

async function promover(args: Argumentos): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  const banco = nomeDoBanco(url);

  if (!banco) {
    throw new Error(
      'DATABASE_URL sem nome de banco no caminho — não dá para saber onde escreveria',
    );
  }

  if (banco !== args.confirmar) {
    throw new Error(
      `O banco configurado é "${banco}", mas --confirmar diz "${args.confirmar}". ` +
        'Nada foi alterado.',
    );
  }

  const prisma = new PrismaClient();

  try {
    const usuario = await prisma.user.findUnique({
      where: { email: args.email },
      select: { id: true, email: true, role: true },
    });

    if (!usuario) {
      throw new Error(
        `Nenhuma conta com o e-mail ${args.email} em "${banco}". ` +
          'Cadastre-se pelo site primeiro — este script não cria conta.',
      );
    }

    if (usuario.role === args.nivel) {
      console.log(
        `${usuario.email} já está como ${nomeDoNivel(args.nivel)}. Nada a fazer.`,
      );
      return;
    }

    const anterior = usuario.role;

    await prisma.user.update({
      where: { id: usuario.id },
      data: { role: args.nivel },
    });

    await prisma.adminAuditLog.create({
      data: {
        action: 'user.role.set',
        entityType: 'user',
        entityId: usuario.id,
        metadata: {
          email: usuario.email,
          de: nomeDoNivel(anterior),
          para: nomeDoNivel(args.nivel),
          origem: 'script promote-admin',
        },
        success: true,
      },
    });

    console.log(
      `${usuario.email}: ${nomeDoNivel(anterior)} → ${nomeDoNivel(args.nivel)} em "${banco}".`,
    );
    console.log(
      'Registrado em admin_audit_logs. A pessoa precisa entrar de novo: o papel\n' +
        'viaja no token de acesso, e o atual ainda diz o papel antigo.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  await promover(lerArgumentos(process.argv.slice(2)));
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(`Falhou: ${errorMessage(erro)}`);
    process.exit(1);
  });
}
