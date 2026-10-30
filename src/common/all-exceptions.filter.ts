import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppError } from './app-error';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
};

/** ทุก error ออกเป็น { error: CODE, ... } */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      return res.status(exception.getStatus()).json(exception.getResponse());
    }
    if (exception instanceof ThrottlerException) {
      return res.status(429).json({ error: 'TOO_MANY_REQUESTS' });
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as { message?: unknown };
      const code = status === 400 ? 'VALIDATION_ERROR' : STATUS_CODES[status] ?? 'ERROR';
      return res.status(status).json({ error: code, message: body?.message ?? exception.message });
    }

    this.logger.error(exception instanceof Error ? exception.stack : JSON.stringify(exception));
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}
