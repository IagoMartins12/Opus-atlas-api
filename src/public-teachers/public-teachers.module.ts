import { Module } from '@nestjs/common';
import { PublicTeachersController } from './public-teachers.controller';
import { PublicTeachersService } from './public-teachers.service';

@Module({
  controllers: [PublicTeachersController],
  providers: [PublicTeachersService],
})
export class PublicTeachersModule {}
