import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { escapeHtml } from '../common/utils/html.util';
import { EMAIL_SAMPLES, renderSample } from '../mail/templates/samples';

/**
 * Writes every email, in Portuguese and English, as HTML files with an
 * index, for a visual review in the browser:
 *
 *   npm run mail:previews -- [--out <folder>] [--assets <base url>]
 *
 * By default the files go to `mail-previews/` (ignored by git) and the
 * images come from the front's `public/` folder on disk, so they show with
 * no server running.
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const out = resolve(arg('--out') ?? 'mail-previews');
const assets =
  arg('--assets') ??
  pathToFileURL(resolve('../Classical-Music/public')).href.replace(/\/$/, '');

const rows: string[] = [];
for (const sample of EMAIL_SAMPLES) {
  const links = (['pt', 'en'] as const).map((language) => {
    const email = renderSample(sample, language, assets);
    const file = `${sample.id}.${language}.html`;
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, file), email.html);
    writeFileSync(join(out, `${sample.id}.${language}.txt`), email.text);
    return `<a href="${file}">${language}</a> <small>${escapeHtml(email.subject)}</small>`;
  });
  rows.push(
    `<tr><td>${sample.group}</td><td>${escapeHtml(sample.name)}</td><td>${links.join('<br>')}</td></tr>`,
  );
}

writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>E-mails do Opus Atlas</title>
<style>body{font:15px system-ui;margin:32px}td{padding:8px 16px 8px 0;vertical-align:top;border-bottom:1px solid #ddd}small{color:#666}</style>
<h1>E-mails do Opus Atlas</h1><table>${rows.join('')}</table>`,
);
console.log(`${EMAIL_SAMPLES.length * 2} e-mails em ${out}/index.html`);
