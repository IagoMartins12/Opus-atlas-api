import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateScoreContributionDto } from './create-score-contribution.dto';

/**
 * `workId`, `assetId` e `externalUrl` ficam de fora: mudar a obra de uma
 * partitura já enviada, ou trocar o arquivo (ou o link) por baixo mantendo o
 * mesmo registro, são operações que confundem o histórico. Para trocar, envie
 * uma partitura nova e remova a antiga.
 */
export class UpdateScoreContributionDto extends PartialType(
  OmitType(CreateScoreContributionDto, [
    'workId',
    'assetId',
    'externalUrl',
  ] as const),
) {}
