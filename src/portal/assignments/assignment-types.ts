import { AssignmentPriority, AssignmentType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export { AssignmentPriority, AssignmentType };

/**
 * Tipo e prioridade da tarefa — enum do Prisma desde 12/09.
 *
 * Ficaram `String` enquanto a base podia ter valor fora da lista: no MongoDB o
 * enum é conferido na **leitura**, e um documento divergente derrubaria a
 * listagem de tarefas. O histórico foi conferido (os valores do front são
 * exatamente estes) e o script `portal:normalize-assignments` normaliza
 * qualquer outra base antes da troca.
 *
 * Os valores são minúsculos, os mesmos que o front sempre gravou: o contrato
 * não mudou. As listas abaixo alimentam a validação dos DTOs.
 */
export const ASSIGNMENT_TYPES = Object.values(AssignmentType);

export const ASSIGNMENT_PRIORITIES = Object.values(AssignmentPriority);

export const SUBMISSION_KINDS = [
  'video',
  'audio',
  'image',
  'document',
  'text',
] as const;

export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

/** Um envio do aluno: um arquivo, um texto, ou os dois. */
export interface SubmissionEntry {
  id: string;
  kind: SubmissionKind;
  note: string | null;
  /** `StoredAsset` correspondente, quando o envio tem arquivo. */
  assetId: string | null;
  url: string | null;
  submittedAt: string;
}

/** Marco de progresso registrado pelo aluno ao longo da tarefa. */
export interface ProgressMilestone {
  label: string;
  progress: number;
  reachedAt: string;
}

/**
 * Conteúdo do campo `submissions`.
 *
 * No legado era um objeto livre em que cada rota escrevia uma chave própria
 * (`videoSubmission`, `progressMilestones`), sem formato combinado. Aqui o
 * formato é um só e a leitura converte o antigo, de modo que nenhum registro
 * precisa de migração para continuar aparecendo.
 */
export interface AssignmentSubmissions {
  entries: SubmissionEntry[];
  milestones: ProgressMilestone[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const asIsoDate = (value: unknown): string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? value
    : new Date().toISOString();

const asSubmissionKind = (value: unknown): SubmissionKind =>
  SUBMISSION_KINDS.includes(value as SubmissionKind)
    ? (value as SubmissionKind)
    : 'document';

/**
 * Converte o vídeo único do formato antigo num envio da lista.
 *
 * O legado guardava um `videoSubmission` só e apagava o anterior a cada novo
 * envio, então o aluno perdia a gravação passada e o professor perdia a
 * evolução. Na leitura ele vira o primeiro item do histórico.
 */
function legacyVideoEntry(value: unknown): SubmissionEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const url =
    asString(value.cloudinaryUrl) ??
    asString(value.filePath) ??
    asString(value.url);

  if (!url) {
    return null;
  }

  return {
    id: asString(value.cloudinaryPublicId) ?? randomUUID(),
    kind: 'video',
    note: asString(value.originalName),
    assetId: null,
    url,
    submittedAt: asIsoDate(value.uploadedAt),
  };
}

function parseEntry(value: unknown): SubmissionEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asString(value.id);

  if (!id) {
    return null;
  }

  return {
    id,
    kind: asSubmissionKind(value.kind),
    note: asString(value.note),
    assetId: asString(value.assetId),
    url: asString(value.url),
    submittedAt: asIsoDate(value.submittedAt),
  };
}

function parseMilestone(value: unknown): ProgressMilestone | null {
  if (!isRecord(value)) {
    return null;
  }

  const label = asString(value.label);

  if (!label) {
    return null;
  }

  return {
    label,
    progress: typeof value.progress === 'number' ? value.progress : 0,
    reachedAt: asIsoDate(value.reachedAt),
  };
}

/**
 * Lê o campo `submissions` em qualquer um dos dois formatos.
 *
 * Nunca lança: um JSON inesperado no banco não pode derrubar a listagem de
 * tarefas. O que não for reconhecido é simplesmente descartado.
 */
export function readSubmissions(value: unknown): AssignmentSubmissions {
  if (!isRecord(value)) {
    return { entries: [], milestones: [] };
  }

  const entries = Array.isArray(value.entries)
    ? value.entries
        .map(parseEntry)
        .filter((entry): entry is SubmissionEntry => entry !== null)
    : [];

  const legacy = legacyVideoEntry(value.videoSubmission);

  const milestones = Array.isArray(value.milestones)
    ? value.milestones
    : Array.isArray(value.progressMilestones)
      ? value.progressMilestones
      : [];

  return {
    entries: legacy ? [legacy, ...entries] : entries,
    milestones: milestones
      .map(parseMilestone)
      .filter(
        (milestone): milestone is ProgressMilestone => milestone !== null,
      ),
  };
}

/** Serializa para o formato aceito pelo Prisma no campo `Json`. */
export function writeSubmissions(
  submissions: AssignmentSubmissions,
): Prisma.InputJsonValue {
  return {
    entries: submissions.entries.map((entry) => ({ ...entry })),
    milestones: submissions.milestones.map((milestone) => ({ ...milestone })),
  };
}

export function newSubmissionId(): string {
  return randomUUID();
}
