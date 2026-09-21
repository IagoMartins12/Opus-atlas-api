import { ApiProperty } from '@nestjs/swagger';

class FormEpochDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Romantismo' })
  name: string;
}

class FormInstrumentDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Piano' })
  name: string;

  @ApiProperty({ example: 'Teclas', nullable: true })
  category: string | null;
}

class FormRoleDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  id: string;

  @ApiProperty({ example: 'Compositor' })
  name: string;
}

/**
 * As listas que abrem junto com os formulários de contribuição. Vêm juntas de
 * propósito: são quase estáticas e eram três rotas no legado.
 */
export class UploadFormDataDto {
  @ApiProperty({ type: [FormEpochDto] })
  epochs: FormEpochDto[];

  @ApiProperty({ type: [FormInstrumentDto] })
  instruments: FormInstrumentDto[];

  @ApiProperty({ type: [FormRoleDto] })
  roles: FormRoleDto[];
}
