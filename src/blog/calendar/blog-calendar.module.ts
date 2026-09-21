import { Module } from '@nestjs/common';
import { ScrapersModule } from '../../scrapers/scrapers.module';
import { CalendarImportService } from './calendar-import.service';
import {
  CalendarController,
  EventsController,
  VenuesController,
} from './calendar.controller';
import { CalendarService } from './calendar.service';
import { EventsService } from './events.service';

@Module({
  // `ScrapersModule` fornece a importação e o registro de scrapers.
  imports: [ScrapersModule],
  controllers: [CalendarController, EventsController, VenuesController],
  providers: [CalendarService, EventsService, CalendarImportService],
})
export class BlogCalendarModule {}
