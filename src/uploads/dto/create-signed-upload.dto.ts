import { ApiProperty } from '@nestjs/swagger';
import { StorageAssetKind } from '@prisma/client';
import { IsEnum, IsString, Matches, MaxLength } from 'class-validator';

export class CreateSignedUploadDto {
  @ApiProperty({
    enum: StorageAssetKind,
    description:
      'Para que serve o arquivo. Determina pasta, limite de tamanho e formatos aceitos.',
    example: StorageAssetKind.PERFORMANCE_VIDEO,
  })
  @IsEnum(StorageAssetKind)
  kind: StorageAssetKind;

  @ApiProperty({
    description:
      'Id da entidade dona do arquivo (obra, tarefa, artigo). Vira subpasta no armazenamento.',
    example: '685d591c1e3db0c5aaa893e4',
  })
  @IsString()
  @MaxLength(64)
  // Só caracteres seguros para caminho: o valor é concatenado na pasta e não
  // pode conter barra ou ponto-ponto, que permitiriam escapar do diretório.
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'scopeId deve conter apenas letras, números, hífen e sublinhado',
  })
  scopeId: string;
}
