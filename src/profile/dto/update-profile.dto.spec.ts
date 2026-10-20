import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

// The same options as the global ValidationPipe (main.ts).
const OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

const errorsFor = (account: object) =>
  validate(plainToInstance(UpdateProfileDto, { account }), OPTIONS);

describe('UpdateProfileDto', () => {
  it('accepts every study horizon, and null to clear it', async () => {
    for (const studyHorizon of ['MONTHS', 'YEAR', 'YEARS', 'LIFE', null]) {
      expect(await errorsFor({ studyHorizon })).toEqual([]);
    }
  });

  it('rejects an unknown study horizon', async () => {
    expect(await errorsFor({ studyHorizon: 'FOREVER' })).not.toHaveLength(0);
  });

  it('keeps the list view to cards or list', async () => {
    expect(await errorsFor({ listView: 'list' })).toEqual([]);
    expect(await errorsFor({ listView: 'grid' })).not.toHaveLength(0);
  });
});
