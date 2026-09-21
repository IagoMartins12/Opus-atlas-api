import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * Traduz erros conhecidos do Prisma em exceções HTTP semânticas,
 * antes de delegar ao AllExceptionsFilter para formatação final da resposta.
 *
 * Referência de códigos: https://www.prisma.io/docs/orm/reference/error-reference
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly delegate = new AllExceptionsFilter();

  catch(
    exception: Prisma.PrismaClientKnownRequestError,
    host: ArgumentsHost,
  ): void {
    let translated: unknown = exception;

    switch (exception.code) {
      case 'P2002': // Unique constraint violation
        translated = new ConflictException(
          `Já existe um registro com esse valor único (${JSON.stringify(exception.meta?.target)})`,
        );
        break;
      case 'P2025': // Record not found
        translated = new NotFoundException('Registro não encontrado');
        break;
      case 'P2003': // Foreign key constraint failure
        translated = new ConflictException(
          'Referência inválida a um registro relacionado',
        );
        break;
      case 'P2023': // Inconsistent column data
        // Id de rota que não é um ObjectId (`/works/nao-e-id`) chega aqui:
        // é erro de quem chamou. Outro P2023 é dado inconsistente no banco e
        // continua 500.
        translated = /Malformed ObjectID/i.test(
          `${exception.message} ${JSON.stringify(exception.meta ?? {})}`,
        )
          ? new BadRequestException('Identificador inválido')
          : exception;
        break;
      default:
        translated = exception;
    }

    this.delegate.catch(translated, host);
  }
}
