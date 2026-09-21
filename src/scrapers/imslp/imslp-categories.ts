/**
 * Categorias do IMSLP aceitas pela plataforma, e a tradução de cada uma.
 *
 * Copiado do legado como dado, pelo mesmo motivo do vocabulário: é
 * correspondência construída contra páginas reais, não lógica a reescrever.
 */

import { WORK_GENRE_TRANSLATIONS } from './imslp-vocabulary';

// Categorias válidas aceitas no sistema
export const VALID_CATEGORIES: Record<string, string> = {
  // Peças gerais
  Pieces: 'Peças',
  Works: 'Obras',
  Compositions: 'Composições',

  // Solo piano
  'For piano (arr)': 'Arranjo para piano',
  'For piano 3 hands': 'Para piano 3 mãos',
  'For piano 4 hands': 'Para piano 4 mãos',
  'For piano 4 hands (arr)': 'Arranjo para piano 4 mãos',

  'For 2 pianos': 'Para 2 pianos',
  'For 2 pianos (arr)': 'Arranjo para 2 pianos',

  // Piano e orquestra
  'For piano, orchestra': 'Para piano e orquestra',
  'For piano, orchestra (arr)': 'Arranjo para piano e orquestra',
  'For 2 pianos, orchestra': 'Para 2 pianos e orquestra',

  // Número de players/instrumentistas
  'For 1 player': 'Para 1 instrumentista',
  'For 2 players': 'Para 2 instrumentistas',
  'For 3 players': 'Para 3 instrumentistas',
  'For 4 players': 'Para 4 instrumentistas',
  'For 5 players': 'Para 5 instrumentistas',
  'For 6 players': 'Para 6 instrumentistas',
  'For 7 players': 'Para 7 instrumentistas',
  'For 8 players': 'Para 8 instrumentistas',
  'For 9 players': 'Para 9 instrumentistas',
  'For 10 players': 'Para 10 instrumentistas',

  // Arranjos por número de players
  'For 1 player (arr)': 'Arranjo para 1 instrumentista',
  'For 2 players (arr)': 'Arranjo para 2 instrumentistas',
  'For 3 players (arr)': 'Arranjo para 3 instrumentistas',
  'For 4 players (arr)': 'Arranjo para 4 instrumentistas',
  'For 5 players (arr)': 'Arranjo para 5 instrumentistas',
  'For 6 players (arr)': 'Arranjo para 6 instrumentistas',
  'For 7 players (arr)': 'Arranjo para 7 instrumentistas',
  'For 8 players (arr)': 'Arranjo para 8 instrumentistas',
};

// Categorias válidas em português (valores do objeto acima)
export const VALID_PORTUGUESE_CATEGORIES = new Set(
  Object.values(VALID_CATEGORIES),
);

// Função para traduzir categoria do inglês para português
export function translateCategory(englishCategory: string): string {
  const categoryLower = englishCategory.toLowerCase().trim();

  for (const [english, portuguese] of Object.entries(VALID_CATEGORIES)) {
    if (english.toLowerCase() === categoryLower) {
      return portuguese;
    }
  }

  return englishCategory; // Retorna original se não encontrar
}

// Função para obter todas as categorias válidas em português
export function getAllValidCategories(): string[] {
  return Array.from(VALID_PORTUGUESE_CATEGORIES).sort();
}

// Função para filtrar e validar categorias
export function filterValidCategories(categories: string[]): string[] {
  return categories
    .map((cat) => cat.trim())
    .filter((cat) => cat.length > 0)
    .map((cat) => {
      // Se é uma categoria em inglês válida, traduzir
      if (VALID_CATEGORIES[cat]) {
        return VALID_CATEGORIES[cat];
      }
      // Se é uma categoria em português válida, manter
      if (VALID_PORTUGUESE_CATEGORIES.has(cat)) {
        return cat;
      }
      // Se não é válida, retornar null
      return null;
    })
    .filter((cat) => cat !== null) as string[];
}

// Mapeamento de épocas/estilos do IMSLP para épocas em português
export const EPOCH_STYLE_MAPPING: Record<string, string> = {
  // Estilos em inglês para épocas em português
  medieval: 'Medieval',
  renaissance: 'Renascentista',
  baroque: 'Barroco',
  classical: 'Clássico',
  romantic: 'Romântico',
  'early 20th century': 'Modernismo',
  modern: 'Contemporâneo',
  contemporary: 'Contemporâneo',
  '20th century': 'Modernismo',
  '21st century': 'Contemporâneo',

  // Variações em português
  renascentista: 'Renascentista',
  barroco: 'Barroco',
  clássico: 'Clássico',
  romântico: 'Romântico',
  romanticism: 'Romântico',
  classicism: 'Clássico',
  modernismo: 'Modernismo',
  contemporâneo: 'Contemporâneo',
};

// Função para mapear estilo para época
export function mapStyleToEpoch(style: string): string | null {
  if (!style) return null;

  const styleLower = style.toLowerCase().trim();
  return EPOCH_STYLE_MAPPING[styleLower] || null;
}

// Função para extrair compositor do link IMSLP
export function extractComposerFromIMSLPId(imslpId: string): {
  lastName: string;
  firstName: string;
  fullName: string;
} | null {
  // Padrão: Symphony_No.40_(Mozart,_Wolfgang_Amadeus)
  const match = imslpId.match(/\(([^,]+),\s*([^)]+)\)$/);

  if (match) {
    const lastName = match[1].trim();
    const firstName = match[2].trim();
    const fullName = `${firstName} ${lastName}`;

    return {
      lastName,
      firstName,
      fullName,
    };
  }

  return null;
}

export const VALID_PORTUGUESE_WORKGENRES = new Set(
  Object.values(WORK_GENRE_TRANSLATIONS),
);
