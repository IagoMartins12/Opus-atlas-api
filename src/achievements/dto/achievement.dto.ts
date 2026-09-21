import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AchievementCategory, AchievementRarity } from '@prisma/client';

export class UnlockedAchievementDto {
  @ApiProperty({ example: 'first-goal' }) badgeId: string;
  @ApiProperty({ example: 'Primeiro Objetivo' }) name: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: AchievementCategory }) category: AchievementCategory;
  @ApiProperty({ enum: AchievementRarity }) rarity: AchievementRarity;
  @ApiProperty({ example: 10 }) xpReward: number;
  @ApiProperty({ description: 'Ainda não vista pelo usuário.' }) isNew: boolean;
  @ApiProperty() unlockedAt: Date;
}

export class LockedAchievementDto {
  @ApiProperty({ example: 'collector-gold' }) badgeId: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: AchievementCategory }) category: AchievementCategory;
  @ApiProperty({ enum: AchievementRarity }) rarity: AchievementRarity;
  @ApiProperty({ example: 50 }) xpReward: number;
  @ApiProperty({ example: 37, description: 'Valor atual da métrica.' })
  progress: number;
  @ApiProperty({ example: 100, description: 'Valor necessário.' })
  maxProgress: number;
  @ApiProperty({ example: 37 }) percentage: number;
}

export class AchievementSummaryDto {
  @ApiProperty({ example: 8 }) unlockedCount: number;
  @ApiProperty({ example: 27 }) totalCount: number;
  @ApiProperty({ example: 2, description: 'Conquistas ainda não vistas.' })
  newCount: number;
}

export class AchievementListResponseDto {
  @ApiProperty({ type: [UnlockedAchievementDto] })
  unlocked: UnlockedAchievementDto[];
  @ApiProperty({ type: [LockedAchievementDto] }) locked: LockedAchievementDto[];
  @ApiProperty({ type: AchievementSummaryDto }) summary: AchievementSummaryDto;
}

export class AchievementProgressResponseDto {
  @ApiProperty({
    type: [LockedAchievementDto],
    description: 'Conquistas pendentes, da mais próxima para a mais distante.',
  })
  pending: LockedAchievementDto[];
}

export class CheckAchievementsResponseDto {
  @ApiProperty({
    type: [UnlockedAchievementDto],
    description: 'Conquistas desbloqueadas nesta verificação.',
  })
  unlocked: Array<Omit<UnlockedAchievementDto, 'isNew' | 'unlockedAt'>>;

  @ApiProperty({ example: 2 }) count: number;
  @ApiProperty({ example: 35, description: 'XP concedido nesta verificação.' })
  xpGained: number;
}

export class AchievementStatsResponseDto {
  @ApiProperty({ example: 285 }) totalXP: number;
  @ApiProperty({ example: 3, description: 'Nível, a cada 100 XP.' })
  level: number;
  @ApiProperty({ example: 85 }) xpIntoLevel: number;
  @ApiProperty({ example: 15 }) xpToNextLevel: number;
  @ApiProperty({ example: 8 }) unlockedCount: number;
  @ApiProperty({ example: 27 }) totalCount: number;
  @ApiProperty({ example: { COMMON: 5, RARE: 2, EPIC: 1 } }) byRarity: Record<
    string,
    number
  >;
  @ApiProperty({ example: { LEARNING: 3, FAVORITES: 4 } }) byCategory: Record<
    string,
    number
  >;
}

export class CatalogAchievementDto {
  @ApiProperty() badgeId: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: AchievementCategory }) category: AchievementCategory;
  @ApiProperty({ enum: AchievementRarity }) rarity: AchievementRarity;
  @ApiProperty() xpReward: number;
  @ApiPropertyOptional({ description: 'Valor da métrica que desbloqueia.' })
  threshold: number;
}

export class AchievementCatalogResponseDto {
  @ApiProperty({ type: [CatalogAchievementDto] })
  achievements: CatalogAchievementDto[];
  @ApiProperty({ example: 27 }) total: number;
}
