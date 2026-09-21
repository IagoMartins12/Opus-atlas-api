import { Module } from '@nestjs/common';
import { PublicAdsController } from './public-ads.controller';
import { PublicAdsService } from './public-ads.service';

/** O lado público dos anúncios; o painel continua em `admin/ads`. */
@Module({
  controllers: [PublicAdsController],
  providers: [PublicAdsService],
})
export class AdsModule {}
