import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const MODERATION_ACTIONS = ['approve', 'reject', 'delete'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export class ResolveModerationDto {
  @ApiProperty({
    enum: MODERATION_ACTIONS,
    description:
      '`approve` mantém o conteúdo, `reject` descarta a denúncia, `delete` remove o conteúdo denunciado.',
  })
  @IsIn(MODERATION_ACTIONS)
  action: ModerationAction;

  @ApiPropertyOptional({
    description:
      'Justificativa do moderador. **Obrigatória quando a ação é `delete`** — ' +
      'aprovar em silêncio tudo bem, derrubar o trabalho de alguém sem motivo ' +
      'escrito, não (RN-4).',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  notes?: string;
}
