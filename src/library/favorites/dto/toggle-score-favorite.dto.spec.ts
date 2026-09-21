import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ToggleScoreFavoriteDto } from './toggle-score-favorite.dto';

// As mesmas opções do ValidationPipe global (main.ts).
const OPTIONS = { whitelist: true, forbidNonWhitelisted: true };
const WORK_ID = '685d591c1e3db0c5aaa89abc';

function validateBody(body: object) {
  return validate(plainToInstance(ToggleScoreFavoriteDto, body), OPTIONS);
}

describe('ToggleScoreFavoriteDto', () => {
  it('aceita os dados da partitura ao adicionar', async () => {
    const errors = await validateBody({
      workId: WORK_ID,
      scoreId: '12345',
      action: 'add',
      scoreData: {
        title: 'Partitura completa',
        type: 'SCORES',
        downloadUrl: 'https://imslp.org/wiki/Special:ImagefromIndex/12345',
        fileSize: '1.2 MB',
        pageCount: '24',
      },
    });

    expect(errors).toEqual([]);
  });

  it('exige o título da partitura ao adicionar', async () => {
    const errors = await validateBody({
      workId: WORK_ID,
      scoreId: '12345',
      action: 'add',
      scoreData: {},
    });

    expect(errors).not.toHaveLength(0);
  });

  it('recusa campo desconhecido nos dados da partitura', async () => {
    const errors = await validateBody({
      workId: WORK_ID,
      scoreId: '12345',
      action: 'add',
      scoreData: { title: 'Partitura', fileFormat: 'PDF' },
    });

    expect(errors).not.toHaveLength(0);
  });

  it('não exige os dados da partitura ao remover', async () => {
    const errors = await validateBody({
      workId: WORK_ID,
      scoreId: '12345',
      action: 'remove',
    });

    expect(errors).toEqual([]);
  });
});
