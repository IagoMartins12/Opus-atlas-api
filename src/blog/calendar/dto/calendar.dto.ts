import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { EventStatus, EventType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const HHMM = /^([01]?\d|2[0-3])[:h]([0-5]\d)?h?$/i;
const UF = /^[A-Z]{2}$/;

function Text(max: number) {
  return applyDecorators(
    ApiPropertyOptional({ maxLength: max }),
    IsOptional(),
    IsString(),
    MaxLength(max),
  );
}

function Ids(description: string) {
  return applyDecorators(
    ApiPropertyOptional({ type: [String], description }),
    IsOptional(),
    IsArray(),
    ArrayMaxSize(100),
    IsMongoId({ each: true }),
  );
}

function Strings(maxItems: number, maxLength: number) {
  return applyDecorators(
    ApiPropertyOptional({ type: [String] }),
    IsOptional(),
    IsArray(),
    ArrayMaxSize(maxItems),
    IsString({ each: true }),
    MaxLength(maxLength, { each: true }),
  );
}

function Time() {
  return applyDecorators(
    ApiPropertyOptional({ example: '19:30' }),
    IsOptional(),
    Matches(HHMM, { message: 'horário no formato HH:mm' }),
  );
}

// -------------------------------------------------------------------------
// Calendário público
// -------------------------------------------------------------------------

export const CALENDAR_VIEWS = ['month', 'week', 'day', 'list'] as const;

/**
 * **Renomeada.** Chamava-se `BlogCalendarQueryDto`, o mesmo nome da classe em
 * `portal/calendar/dto/calendar-query.dto.ts` — e o registro de schemas do Swagger é por nome,
 * então uma sobrescrevia a outra no contrato: quem gerava cliente recebia os
 * campos da errada.
 */
export class BlogCalendarQueryDto {
  @ApiProperty({ example: '2026-09-01' })
  @IsDateString()
  start!: string;

  @ApiProperty({ example: '2026-09-30' })
  @IsDateString()
  end!: string;

  @ApiPropertyOptional({ enum: CALENDAR_VIEWS, default: 'month' })
  @IsOptional()
  @IsIn(CALENDAR_VIEWS)
  view?: (typeof CALENDAR_VIEWS)[number];

  @Text(100)
  city?: string;

  @ApiPropertyOptional({ example: 'RJ' })
  @IsOptional()
  @Matches(UF, { message: 'estado é a UF, em maiúsculas (ex.: RJ)' })
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  venueId?: string;

  @ApiPropertyOptional({ enum: EventType })
  @IsOptional()
  @IsEnum(EventType)
  type?: EventType;

  @ApiPropertyOptional({
    enum: EventStatus,
    description:
      'Só administrador filtra por estado; o público vê só publicado.',
  })
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;
}

// -------------------------------------------------------------------------
// Evento
// -------------------------------------------------------------------------

export class CreateEventDto {
  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  title!: string;

  @Text(300)
  subtitle?: string | null;

  @Text(20_000)
  description?: string | null;

  @Text(50_000)
  fullDetails?: string | null;

  @ApiProperty({ enum: EventType })
  @IsEnum(EventType)
  type!: EventType;

  @ApiPropertyOptional({ enum: EventStatus, default: EventStatus.PENDING })
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @ApiProperty()
  @IsMongoId()
  venueId!: string;

  @Text(200)
  room?: string | null;

  @ApiProperty({ description: 'Instante de início, com fuso (ISO 8601)' })
  @IsDateString()
  startDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @Time()
  startTime?: string | null;

  @Time()
  endTime?: string | null;

  @ApiPropertyOptional({ description: 'Minutos' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  duration?: number | null;

  @Text(100)
  doors?: string | null;

  @Text(20_000)
  program?: string | null;

  @Strings(100, 200)
  performers?: string[];

  @Text(200)
  conductor?: string | null;

  @Strings(100, 200)
  soloists?: string[];

  @Text(200)
  ensemble?: string | null;

  @Ids('Compositores')
  composerIds?: string[];

  @Ids('Obras')
  workIds?: string[];

  @Ids('Instrumentos')
  instrumentIds?: string[];

  @Ids('Épocas')
  epochIds?: string[];

  @Text(2048)
  ticketUrl?: string | null;

  @Text(200)
  ticketPrice?: string | null;

  @Text(1000)
  ticketInfo?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @Text(2048)
  imageUrl?: string | null;

  @Text(2048)
  coverImageUrl?: string | null;

  @Strings(30, 2048)
  galleryImages?: string[];

  @Text(2048)
  videoUrl?: string | null;

  @Text(2048)
  externalUrl?: string | null;

  @Text(20)
  ageRating?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  featuredOrder?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @Text(500)
  venueDetails?: string | null;

  @Text(200)
  metaTitle?: string | null;

  @Text(500)
  metaDescription?: string | null;

  @Strings(30, 60)
  keywords?: string[];
}

export class UpdateEventDto extends PartialType(CreateEventDto) {}

// -------------------------------------------------------------------------
// Local
// -------------------------------------------------------------------------

export class CreateVenueDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @Text(100)
  shortName?: string | null;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city!: string;

  @ApiProperty({
    example: 'RJ',
    description: 'UF — decide o fuso do calendário',
  })
  @Matches(UF, { message: 'estado é a UF, em maiúsculas (ex.: RJ)' })
  state!: string;

  @Text(100)
  country?: string;

  @Text(300)
  address?: string | null;

  @Text(20)
  zipCode?: string | null;

  @Text(2048)
  website?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @Text(40)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200_000)
  capacity?: number | null;

  @Text(5000)
  description?: string | null;

  @Text(20_000)
  history?: string | null;

  @Text(2048)
  logoUrl?: string | null;

  @Text(2048)
  coverImageUrl?: string | null;

  @Strings(30, 2048)
  galleryImages?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  scrapingEnabled?: boolean;

  @Text(2048)
  scrapingUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Text(200)
  metaTitle?: string | null;

  @Text(500)
  metaDescription?: string | null;
}

export class UpdateVenueDto extends PartialType(CreateVenueDto) {}

// -------------------------------------------------------------------------
// Importação em lote (fluxo "buscar eventos" do painel)
// -------------------------------------------------------------------------

export class CheckDuplicatesDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description:
      'Eventos raspados, como vieram do scraper. Só `externalId` é lido; o ' +
      'resto volta como está, com as marcações de duplicata.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsObject({ each: true })
  events!: Record<string, unknown>[];
}

export class ScrapedEventDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) title!: string;

  @ApiProperty()
  @Matches(/^[a-z0-9-]{1,200}$/, {
    message: 'slug em minúsculas, dígitos e hífens',
  })
  slug!: string;

  @Text(20_000) description?: string | null;
  @ApiProperty({ enum: EventType }) @IsEnum(EventType) type!: EventType;
  @ApiProperty() @IsDateString() startDate!: string;
  @Time() startTime?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string | null;
  @Time() endTime?: string | null;
  @Text(500) venueDetails?: string | null;
  @Text(2048) ticketUrl?: string | null;
  @Text(2048) externalUrl?: string | null;
  @Text(1000) ticketInfo?: string | null;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) externalId!: string;
  @Text(2048) imageUrl?: string | null;
  @Strings(50, 200) composerNames?: string[];
  @Strings(100, 200) performers?: string[];
  @Text(20_000) program?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  duration?: number;

  // Marcações que o próprio painel acrescenta ao evento raspado (seleção e
  // duplicata). Aceitas e ignoradas, para a validação estrita não recusar o
  // evento que o painel devolve como recebeu.
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsBoolean() selected?: boolean;
  @IsOptional() @IsBoolean() alreadyExists?: boolean;
  @IsOptional() @IsBoolean() isDuplicate?: boolean;
  @IsOptional() @IsString() existingEventId?: string;
  @IsOptional() @IsString() existingEventSlug?: string;
}

export class BulkInsertDto {
  @ApiProperty({
    example: 'osesp',
    description: 'Scraper de onde os eventos vieram',
  })
  @IsString()
  @MaxLength(60)
  scraperId!: string;

  @ApiProperty({ type: [ScrapedEventDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ScrapedEventDto)
  events!: ScrapedEventDto[];
}
