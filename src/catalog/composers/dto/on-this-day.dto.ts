import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class OnThisDayQueryDto {
  @ApiProperty({ minimum: 1, maximum: 12, example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ minimum: 1, maximum: 31, example: 17 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  day: number;
}

export class OnThisDayComposerDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() fullName: string;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Só retrato válido (sem o "no photo" do IMSLP)',
  })
  portraitUrl: string | null;
  @ApiPropertyOptional({ nullable: true }) birthYear: number | null;
  @ApiPropertyOptional({ nullable: true }) deathYear: number | null;
  @ApiPropertyOptional({ nullable: true }) nationality: string | null;
  @ApiPropertyOptional({ nullable: true }) epochName: string | null;
  @ApiProperty() isVerified: boolean;
}

export class OnThisDayDto {
  @ApiProperty() month: number;
  @ApiProperty() day: number;
  @ApiProperty({ type: [OnThisDayComposerDto] }) born: OnThisDayComposerDto[];
  @ApiProperty({ type: [OnThisDayComposerDto] }) died: OnThisDayComposerDto[];
}
