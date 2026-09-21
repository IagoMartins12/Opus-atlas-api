import { PlanType } from '@prisma/client';

/**
 * Matriz de features por plano — portada de `subscriptionConstants.ts`
 * (`PLAN_FEATURES`) do legado. Puramente estática (não depende de banco),
 * então fica como constante de código, igual ao legado.
 *
 * **RN-1 decidida: "professor" é papel, não plano.** Quem é professor tem
 * portal, aula, tarefa e notificação; o plano gradua **quantidade**
 * (`maxStudents`, `uploadLimit`, `maxPerformanceVideos`) e **sofisticação**
 * (`taskCreation: 'basic'` contra `'advanced'`, relatórios avançados). Foi a
 * leitura da própria matriz que forçou a decisão: aplicada ao pé da letra, ela
 * dizia que um professor MENTOR **não recebe notificação** — nem a de que a
 * aula dele começa em uma hora. Isso não é recurso pago, é a função básica
 * funcionando.
 *
 * **`notifications` passou a `true` em todos os planos** por essa razão. O
 * campo controlava se a pessoa é avisada de aula, tarefa e convite: cobrar por
 * isso é vender um portal que não avisa o dono. Os demais booleanos ficaram
 * como estavam.
 */
export interface PlanFeatureSet {
  catalogAccess: boolean;
  wantToLearn: boolean;
  alreadyLearned: boolean;
  basicProgress: boolean;
  gamificationXP: boolean;
  uploadLimit: number;
  maxPerformanceVideos: number;
  smartRecommendations: boolean;
  aiAssistant: boolean;
  weeklyGoals: boolean;
  personalReports: boolean;
  visualProgressHistory: boolean;
  guidedAnalysis: boolean;
  teacherDashboard: boolean;
  studentManagement: boolean;
  maxStudents: number;
  taskCreation: false | 'basic' | 'advanced';
  lessonScheduling: boolean;
  materialsLibrary: boolean;
  videoSubmissions: boolean;
  advancedReports: boolean;
  notifications: boolean;
  publicProfile: boolean;
  verifiedBadge: boolean;
  directoryFeatured: boolean;
  marketplacePriority: boolean;
  prioritySupport: boolean;
}

export const PLAN_FEATURES: Record<PlanType, PlanFeatureSet> = {
  FREE: {
    catalogAccess: true,
    wantToLearn: true,
    alreadyLearned: true,
    basicProgress: true,
    gamificationXP: true,
    uploadLimit: 3,
    maxPerformanceVideos: 3,
    smartRecommendations: false,
    aiAssistant: false,
    weeklyGoals: false,
    personalReports: false,
    visualProgressHistory: false,
    guidedAnalysis: false,
    teacherDashboard: false,
    studentManagement: false,
    maxStudents: 0,
    taskCreation: false,
    lessonScheduling: false,
    materialsLibrary: false,
    videoSubmissions: false,
    advancedReports: false,
    notifications: true,
    publicProfile: false,
    verifiedBadge: false,
    directoryFeatured: false,
    marketplacePriority: false,
    prioritySupport: false,
  },
  PLUS: {
    catalogAccess: true,
    wantToLearn: true,
    alreadyLearned: true,
    basicProgress: true,
    gamificationXP: true,
    uploadLimit: -1,
    maxPerformanceVideos: -1,
    smartRecommendations: true,
    aiAssistant: true,
    weeklyGoals: true,
    personalReports: true,
    visualProgressHistory: true,
    guidedAnalysis: true,
    teacherDashboard: false,
    studentManagement: false,
    maxStudents: 0,
    taskCreation: false,
    lessonScheduling: false,
    materialsLibrary: false,
    videoSubmissions: false,
    advancedReports: false,
    notifications: true,
    publicProfile: false,
    verifiedBadge: false,
    directoryFeatured: false,
    marketplacePriority: false,
    prioritySupport: false,
  },
  MENTOR: {
    catalogAccess: true,
    wantToLearn: true,
    alreadyLearned: true,
    basicProgress: true,
    gamificationXP: true,
    uploadLimit: -1,
    maxPerformanceVideos: -1,
    smartRecommendations: true,
    aiAssistant: true,
    weeklyGoals: true,
    personalReports: true,
    visualProgressHistory: true,
    guidedAnalysis: true,
    teacherDashboard: true,
    studentManagement: true,
    maxStudents: 7,
    taskCreation: 'basic',
    lessonScheduling: true,
    materialsLibrary: true,
    videoSubmissions: false,
    advancedReports: false,
    notifications: true,
    publicProfile: true,
    verifiedBadge: false,
    directoryFeatured: false,
    marketplacePriority: false,
    prioritySupport: false,
  },
  MAESTRO: {
    catalogAccess: true,
    wantToLearn: true,
    alreadyLearned: true,
    basicProgress: true,
    gamificationXP: true,
    uploadLimit: -1,
    maxPerformanceVideos: -1,
    smartRecommendations: true,
    aiAssistant: true,
    weeklyGoals: true,
    personalReports: true,
    visualProgressHistory: true,
    guidedAnalysis: true,
    teacherDashboard: true,
    studentManagement: true,
    maxStudents: -1,
    taskCreation: 'advanced',
    lessonScheduling: true,
    materialsLibrary: true,
    videoSubmissions: true,
    advancedReports: true,
    notifications: true,
    publicProfile: true,
    verifiedBadge: true,
    directoryFeatured: true,
    marketplacePriority: true,
    prioritySupport: true,
  },
};

export const TRIAL_PERIOD_DAYS: Record<PlanType, number> = {
  FREE: 0,
  PLUS: 7,
  MENTOR: 14,
  MAESTRO: 30,
};

export function hasFeature(
  plan: PlanType,
  feature: keyof PlanFeatureSet,
): boolean {
  const value = PLAN_FEATURES[plan][feature];
  return (
    value === true || value === -1 || (typeof value === 'string' && !!value)
  );
}

export function getFeatureLimit(
  plan: PlanType,
  feature: keyof PlanFeatureSet,
): number {
  const value = PLAN_FEATURES[plan][feature];
  return typeof value === 'number' ? value : 0;
}

const PLAN_ORDER: PlanType[] = ['FREE', 'PLUS', 'MENTOR', 'MAESTRO'];

export function getPlanChangeType(
  fromPlan: PlanType,
  toPlan: PlanType,
): 'UPGRADE' | 'DOWNGRADE' | 'SAME' {
  const fromIndex = PLAN_ORDER.indexOf(fromPlan);
  const toIndex = PLAN_ORDER.indexOf(toPlan);

  if (fromIndex < toIndex) return 'UPGRADE';
  if (fromIndex > toIndex) return 'DOWNGRADE';
  return 'SAME';
}
