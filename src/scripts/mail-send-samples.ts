import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as nodemailer from 'nodemailer';
import { EMAIL_SAMPLES, renderSample } from '../mail/templates/samples';

/**
 * Sends every email to one address, for a look in real inboxes (Gmail,
 * Outlook, Apple Mail):
 *
 *   npm run mail:send-samples -- --to <email> [--lang pt|en|both] [--only <id,id>]
 *
 * Uses the environment's SMTP. By default the seal and emblems go attached and
 * inline (`cid:`), for when the site does not serve them publicly yet. With
 * `--assets <site address>` (for example `https://hml.opusatlas.com.br`) the
 * email keeps the real image URLs, exactly as a real send does, and nothing is
 * attached: it is the way to see what a customer sees.
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  const to = arg('--to');
  if (!to) throw new Error('Informe --to <email>.');
  const languages =
    arg('--lang') === 'en'
      ? (['en'] as const)
      : arg('--lang') === 'both'
        ? (['pt', 'en'] as const)
        : (['pt'] as const);
  const only = arg('--only')?.split(',');
  const publicDir = resolve(arg('--public') ?? '../Classical-Music/public');
  const assets = arg('--assets')?.replace(/\/$/, '');
  const base = assets ?? 'https://assets.invalid';

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const samples = EMAIL_SAMPLES.filter((s) => !only || only.includes(s.id));
  for (const sample of samples) {
    for (const language of languages) {
      const email = renderSample(sample, language, base);
      // Com o endereço real, o HTML segue como está e nada vai anexado.
      const images = assets
        ? []
        : [
            ...new Set(
              [
                ...email.html.matchAll(
                  /https:\/\/assets\.invalid\/email\/([\w-]+\.png)/g,
                ),
              ].map((m) => m[1]),
            ),
          ];
      const html = assets
        ? email.html
        : email.html.replace(
            /https:\/\/assets\.invalid\/email\/([\w-]+)\.png/g,
            'cid:$1',
          );
      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to,
        subject: `[Prévia ${language}] ${email.subject}`,
        html,
        text: email.text,
        attachments: images.map((file) => ({
          filename: file,
          content: readFileSync(resolve(publicDir, 'email', file)),
          cid: file.replace(/\.png$/, ''),
        })),
      });
      console.log(`enviado: ${sample.id} (${language})`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
