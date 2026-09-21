import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { AccessTokenPayload } from '../../auth/interfaces/jwt-payload.interface';
import { Audited } from '../../common/audit/audit.decorator';
import { Public } from '../../common/decorators/api-key.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';
import { CalendarImportService } from './calendar-import.service';
import { CalendarService, MAX_RANGE_DAYS } from './calendar.service';
import {
  BulkInsertDto,
  BlogCalendarQueryDto,
  CheckDuplicatesDto,
  CreateEventDto,
  CreateVenueDto,
  UpdateEventDto,
  UpdateVenueDto,
} from './dto/calendar.dto';
import { EventsService } from './events.service';

/** O calendário público e o fluxo de importação do painel. */
@ApiTags('blog-calendar')
@Controller('blog/calendar')
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly importer: CalendarImportService,
  ) {}

  @Get()
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Eventos de um período',
    description:
      `Até ${MAX_RANGE_DAYS} dias. Só evento publicado para o público; ` +
      'temporada que começou antes do período entra nele. O horário é o ' +
      'gravado — o legado o refazia no fuso do servidor e errava três horas ' +
      'em contêiner. Os filtros vêm dos locais ativos (o legado usava só os ' +
      'com scraping ligado, e os cinco da base estão desligados).',
  })
  @ApiOkResponse({ description: 'Eventos, agregados e filtros' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  get(
    @Query() query: BlogCalendarQueryDto,
    @CurrentUser() user: AccessTokenPayload | undefined,
  ) {
    return this.calendar.calendar(query, user);
  }

  @Post('events/check-duplicates')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Marca quais eventos raspados já existem',
    description:
      'A rota do legado não tinha autenticação nenhuma — qualquer um sondava ' +
      'quais `externalId` existiam. Aqui, só administrador.',
  })
  @ApiOkResponse({ description: 'Os eventos, com a marcação de duplicata' })
  checkDuplicates(@Body() dto: CheckDuplicatesDto) {
    return this.importer.checkDuplicates(dto.events);
  }

  @Post('events/bulk-insert')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Audited({ action: 'blog.calendar.bulk-insert', entityType: 'event' })
  @ApiOperation({
    summary: 'Importa os eventos escolhidos',
    description:
      'Pela mesma importação dos scrapers na fila: a casa sai da configuração ' +
      'do scraper (o legado só conhecia duas das sete e caía com 500 no meio ' +
      'do laço), e a rodada fica registrada.',
  })
  @ApiOkResponse({ description: 'Resultado evento a evento' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  bulkInsert(@Body() dto: BulkInsertDto) {
    return this.importer.bulkInsert(dto.scraperId, dto.events);
  }
}

/**
 * Eventos do calendário.
 *
 * Escrita exige `ADMIN` ou acima — o legado conferia `role !== 1` e barrava o
 * super administrador. A edição é `PATCH` (era `PUT`).
 */
@ApiTags('blog-calendar')
@Controller('blog/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Audited({ action: 'blog.event.create', entityType: 'event' })
  @ApiOperation({
    summary: 'Cria um evento',
    description: 'Nasce pendente, salvo `status`.',
  })
  @ApiOkResponse({ description: 'Evento criado' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({
    description: 'Local inexistente',
    type: ErrorResponseDto,
  })
  create(@Body() dto: CreateEventDto, @CurrentUser() user: AccessTokenPayload) {
    return this.events.createEvent(dto, user.sub);
  }

  @Get(':id')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Um evento',
    description: 'Fora do ar, só para administrador.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Evento com o local' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(
    @Param('id') id: string,
    @CurrentUser() user: AccessTokenPayload | undefined,
  ) {
    return this.events.getEvent(id, user);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Audited({
    action: 'blog.event.update',
    entityType: 'event',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Edita um evento',
    description:
      'Só os campos do evento — o legado repassava o corpo ao Prisma, e ' +
      '`viewCount`, `source` e `verifiedBy` mudavam por ali.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Evento atualizado' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: AccessTokenPayload,
  ) {
    return this.events.updateEvent(id, dto, user.sub);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Audited({
    action: 'blog.event.delete',
    entityType: 'event',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Apaga um evento' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Evento apagado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(@Param('id') id: string) {
    return this.events.deleteEvent(id);
  }
}

/** Locais do calendário. */
@ApiTags('blog-calendar')
@Controller('blog/venues')
export class VenuesController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Audited({ action: 'blog.venue.create', entityType: 'venue' })
  @ApiOperation({
    summary: 'Cria um local',
    description:
      'A UF decide o fuso em que o calendário mostra os eventos dele.',
  })
  @ApiOkResponse({ description: 'Local criado' })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  create(@Body() dto: CreateVenueDto) {
    return this.events.createVenue(dto);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Um local, com o número de eventos' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Local' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(@Param('id') id: string) {
    return this.events.getVenue(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Audited({
    action: 'blog.venue.update',
    entityType: 'venue',
    entityIdParam: 'id',
  })
  @ApiOperation({
    summary: 'Edita um local',
    description:
      'O slug não muda: é por ele que a importação dos scrapers acha a casa.',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Local atualizado' })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateVenueDto) {
    return this.events.updateVenue(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiBearerAuth('access-token')
  @Audited({
    action: 'blog.venue.delete',
    entityType: 'venue',
    entityIdParam: 'id',
  })
  @ApiOperation({ summary: 'Apaga um local sem eventos' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Local apagado' })
  @ApiBadRequestResponse({
    description: 'O local tem eventos',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  remove(@Param('id') id: string) {
    return this.events.deleteVenue(id);
  }
}
