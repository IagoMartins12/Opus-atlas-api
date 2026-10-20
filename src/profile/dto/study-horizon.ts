/** How long a student means to keep studying, asked in the welcome questions. */
export const STUDY_HORIZONS = ['MONTHS', 'YEAR', 'YEARS', 'LIFE'] as const;
export type StudyHorizon = (typeof STUDY_HORIZONS)[number];
