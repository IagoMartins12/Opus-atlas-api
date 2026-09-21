import { ApiProperty } from '@nestjs/swagger';

class ExportSubjectDto {
  @ApiProperty({ example: '685d591c1e3db0c5aaa893e4' })
  userId: string;

  @ApiProperty({ example: 'pessoa@exemplo.com' })
  email: string;
}

class ExportExclusionDto {
  @ApiProperty({ example: 'hashedPassword' })
  what: string;

  @ApiProperty({
    example: 'Credencial: portabilidade é levar os seus dados, não as chaves.',
  })
  why: string;
}

/**
 * O documento de portabilidade (LGPD, Art. 18, V): tudo o que a plataforma
 * guarda sobre quem pediu, em seções, mais a lista do que ficou de fora e por
 * quê. O que foi cortado aparece explicitamente — um arquivo incompleto que
 * não avisa disso é pior que nenhum.
 */
export class PersonalDataExportDto {
  @ApiProperty({ example: '1.0' })
  formatVersion: string;

  @ApiProperty()
  generatedAt: Date;

  @ApiProperty({ type: ExportSubjectDto })
  subject: ExportSubjectDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Uma chave por seção (conta, favoritos, anotações, aulas…), com o ' +
      'recorte de campos daquela seção.',
  })
  sections: Record<string, unknown>;

  @ApiProperty({
    type: [String],
    description:
      'Seções que bateram no teto de 50 mil linhas — nelas o arquivo não ' +
      'está completo.',
  })
  truncatedSections: string[];

  @ApiProperty({ type: [ExportExclusionDto] })
  excluded: ExportExclusionDto[];
}
