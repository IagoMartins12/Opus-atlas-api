// O pdfkit é CommonJS (`module.exports = PDFDocument`) e o projeto não liga o
// `esModuleInterop`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');

/**
 * O relatório compartilhado em PDF (21/10/2026), para o aluno guardar ou
 * imprimir. Lê o retrato gravado (`reportData`), não gera de novo: o PDF diz
 * exatamente o que o relatório na tela diz.
 *
 * Fontes padrão do PDF (Helvetica): cobrem os acentos do português sem
 * embutir arquivo de fonte.
 */

interface Ranked {
  item: string;
  count: number;
}

interface ReportSnapshot {
  overview?: {
    completedLessons: number;
    totalLessons: number;
    attendanceRate: number | null;
    lessonMinutes: number;
    completedAssignments: number;
    totalAssignments: number;
    avgEngagement: number | null;
    avgPreparation: number | null;
    worksLearned: number;
  };
  insights?: { strengths: Ranked[]; challenges: Ranked[] };
  skills?: {
    skills: Array<{
      label: string;
      current: number | null;
      change: number | null;
      lessons: number;
      practiceMinutes: number;
    }>;
  };
  repertoire?: {
    recentlyLearned?: Array<{ title: string; composer: string }>;
  };
}

export interface ReportPdfInput {
  title: string;
  studentName: string;
  teacherName: string;
  periodLabel: string;
  teacherMessage: string | null;
  reportData: unknown;
  nextPieces: Array<{ title: string; composer: string; note: string | null }>;
  tips: string[];
}

const INK = '#1c1915';
const SOFT = '#6b645a';
const GOLD = '#a8862a';
const LINE = '#ddd6c8';

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? 'Sem dado' : `${Math.round(v)}%`;
const score = (v: number | null | undefined) =>
  v === null || v === undefined
    ? 'Sem dado'
    : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} de 5`;
const hours = (minutes: number) =>
  minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? String(minutes % 60).padStart(2, '0') : ''}`
    : `${minutes} min`;

/** As seções, do formato atual (direto) ou do embrulhado em `report`. */
function sectionsOf(raw: unknown): ReportSnapshot {
  if (!raw || typeof raw !== 'object') return {};
  const wrapped = (raw as { report?: ReportSnapshot }).report;
  return wrapped && typeof wrapped === 'object'
    ? wrapped
    : (raw as ReportSnapshot);
}

export function buildReportPdf(input: ReportPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 56, left: 56, right: 56 },
    info: {
      Title: input.title,
      Author: input.teacherName,
      Creator: 'Opus Atlas',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - 112;
  const r = sectionsOf(input.reportData);

  const heading = (text: string) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(1.2);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(text);
    const y = doc.y + 4;
    doc
      .moveTo(56, y)
      .lineTo(56 + width, y)
      .lineWidth(0.6)
      .strokeColor(LINE)
      .stroke();
    doc.moveDown(0.6);
  };
  const body = (text: string, color = INK) =>
    doc.font('Helvetica').fontSize(10.5).fillColor(color).text(text, { width });
  const bullet = (text: string) =>
    doc
      .font('Helvetica')
      .fontSize(10.5)
      .fillColor(INK)
      .text(`•  ${text}`, { width, indent: 0, paragraphGap: 3 });

  // Cabeçalho
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(GOLD)
    .text('OPUS ATLAS  ·  RELATÓRIO DE PROGRESSO', { characterSpacing: 1 });
  doc.moveDown(0.6);
  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor(INK)
    .text(input.title, { width });
  doc.moveDown(0.3);
  body(
    `${input.studentName}  ·  ${input.periodLabel}  ·  Professor(a): ${input.teacherName}`,
    SOFT,
  );

  if (input.teacherMessage) {
    heading('Mensagem do professor');
    doc
      .font('Helvetica-Oblique')
      .fontSize(11)
      .fillColor(INK)
      .text(input.teacherMessage, { width });
  }

  const o = r.overview;
  if (o) {
    heading('Visão geral');
    const rows: Array<[string, string]> = [
      ['Aulas', `${o.completedLessons} de ${o.totalLessons}`],
      ['Presença', pct(o.attendanceRate)],
      ['Tempo de aula', hours(o.lessonMinutes)],
      ['Tarefas', `${o.completedAssignments} de ${o.totalAssignments}`],
      ['Engajamento', score(o.avgEngagement)],
      ['Preparo', score(o.avgPreparation)],
      ['Obras aprendidas', String(o.worksLearned)],
    ];
    for (const [label, value] of rows) {
      const y = doc.y;
      doc
        .font('Helvetica')
        .fontSize(10.5)
        .fillColor(SOFT)
        .text(label, 56, y, { width: 200 });
      doc
        .font('Helvetica-Bold')
        .fillColor(INK)
        .text(value, 256, y, { width: width - 200 });
      doc.moveDown(0.15);
    }
    doc.x = 56;
  }

  const skills = r.skills?.skills ?? [];
  if (skills.length) {
    heading('Evolução por habilidade');
    for (const s of skills) {
      const change =
        s.change === null
          ? ''
          : s.change > 0
            ? `  (subiu ${s.change.toLocaleString('pt-BR')})`
            : s.change < 0
              ? `  (caiu ${Math.abs(s.change).toLocaleString('pt-BR')})`
              : '  (estável)';
      const extra = [
        `${s.lessons} ${s.lessons === 1 ? 'aula' : 'aulas'}`,
        s.practiceMinutes ? `${hours(s.practiceMinutes)} de prática` : null,
      ]
        .filter(Boolean)
        .join(', ');
      const y = doc.y;
      doc
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .fillColor(INK)
        .text(s.label, 56, y, { width: 140 });
      doc
        .font('Helvetica')
        .fillColor(INK)
        .text(`${score(s.current)}${change}`, 196, y, { width: 170 });
      doc.fillColor(SOFT).text(extra, 366, y, { width: width - 310 });
      doc.moveDown(0.2);
    }
    doc.x = 56;
  }

  if (r.insights) {
    const strengths = r.insights.strengths.slice(0, 5);
    const challenges = r.insights.challenges.slice(0, 5);
    if (strengths.length) {
      heading('Pontos fortes');
      strengths.forEach((s) => bullet(s.item));
    }
    if (challenges.length) {
      heading('Desafios');
      challenges.forEach((s) => bullet(s.item));
    }
  }

  const learned = r.repertoire?.recentlyLearned ?? [];
  if (learned.length) {
    heading('Aprendeu no período');
    learned.slice(0, 10).forEach((w) => bullet(`${w.title}, ${w.composer}`));
  }

  if (input.nextPieces.length) {
    heading('Para estudar a seguir');
    for (const piece of input.nextPieces) {
      bullet(`${piece.title}, ${piece.composer}`);
      if (piece.note) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(SOFT)
          .text(piece.note, { width, indent: 14, paragraphGap: 4 });
      }
    }
  }

  if (input.tips.length) {
    heading('Dicas do professor');
    input.tips.forEach((tip) => bullet(tip));
  }

  doc.moveDown(2);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(SOFT)
    .text(
      `Gerado pelo Opus Atlas com os números do período (${input.periodLabel}).`,
      {
        width,
      },
    );

  doc.end();
  return done;
}
