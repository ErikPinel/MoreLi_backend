import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';

type TracedRequest = Request & { requestId?: string };

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<TracedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = Date.now();
    let failureStatus: number | undefined;

    return next.handle().pipe(
      tap({ error: (error: unknown) => { failureStatus = error instanceof HttpException ? error.getStatus() : 500; } }),
      finalize(() => {
        this.logger.log(
          JSON.stringify({
            requestId: request.requestId,
            method: request.method,
            path: request.path,
            statusCode: failureStatus ?? response.statusCode,
            durationMs: Date.now() - startedAt,
          }),
        );
      }),
    );
  }
}