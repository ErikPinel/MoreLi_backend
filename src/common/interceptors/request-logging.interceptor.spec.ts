import { CallHandler, ExecutionContext, Logger, ServiceUnavailableException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RequestLoggingInterceptor } from './request-logging.interceptor.js';

describe('HTTP request outcome logging', () => {
  afterEach(() => vi.restoreAllMocks());
  const context = (statusCode: number) => ({ switchToHttp: () => ({
    getRequest: () => ({ requestId: 'request-id', method: 'GET', path: '/api/users/me' }),
    getResponse: () => ({ statusCode }),
  }) }) as unknown as ExecutionContext;

  it('logs a failed request as 503 even before the response filter changes status', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const error = new ServiceUnavailableException('private provider details');
    const handler = { handle: () => throwError(() => error) } as CallHandler;
    await expect(lastValueFrom(new RequestLoggingInterceptor().intercept(context(200), handler))).rejects.toBe(error);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({ statusCode: 503, path: '/api/users/me' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private provider details');
  });

  it('logs unknown failures as 500 and preserves successful response status', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await expect(lastValueFrom(new RequestLoggingInterceptor().intercept(context(200), { handle: () => throwError(() => new Error('private')) }))).rejects.toThrow('private');
    expect(JSON.parse(log.mock.calls[0][0] as string).statusCode).toBe(500);
    await expect(lastValueFrom(new RequestLoggingInterceptor().intercept(context(201), { handle: () => of({ saved: true }) }))).resolves.toEqual({ saved: true });
    expect(JSON.parse(log.mock.calls[1][0] as string).statusCode).toBe(201);
  });
});