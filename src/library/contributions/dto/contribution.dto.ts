import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ContributionAuthorDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class ContributionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['BIO', 'VIDEO', 'CURIOSITY', 'CORRECTION'] })
  kind!: string;
  @ApiProperty() entityType!: string;
  @ApiProperty() entityId!: string;
  @ApiPropertyOptional({ nullable: true }) field!: string | null;
  @ApiProperty({ description: 'XP pago por esta contribuição.' })
  xp!: number;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ type: ContributionAuthorDto })
  author!: ContributionAuthorDto;
}

export class CuriosityResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() text!: string;
  @ApiProperty({ enum: ['EDITORIAL', 'USER'] }) source!: string;
  @ApiPropertyOptional({ type: ContributionAuthorDto, nullable: true })
  author!: ContributionAuthorDto | null;
  @ApiProperty({ description: 'Escrita por quem chama.' }) mine!: boolean;
  @ApiProperty({ description: 'Fora do ar por denúncia (só o autor vê).' })
  held!: boolean;
}
