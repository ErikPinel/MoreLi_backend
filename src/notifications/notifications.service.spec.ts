import { Logger } from '@nestjs/common';
import type { SupabaseService } from '../database/supabase.service.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';

describe('Stale inquiry cleanup scheduling', () => {
  const normalInterval = 15 * 60 * 1000;
  const retryInterval = 60 * 1000;
  let repository: NotificationsRepository;
  let service: NotificationsService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    repository = new NotificationsRepository({} as SupabaseService);
    vi.spyOn(repository, 'expireStaleInquiries').mockResolvedValue(0);
    service = new NotificationsService(repository);
  });

  afterEach(() => {
    service.onApplicationShutdown();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('runs at startup, then every fifteen minutes after completion', async () => {
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.expireStaleInquiries).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(normalInterval - 1);
    expect(repository.expireStaleInquiries).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(repository.expireStaleInquiries).toHaveBeenCalledTimes(2);
  });

  it('retries the first failure after one minute and backs off persistent failures', async () => {
    vi.mocked(repository.expireStaleInquiries)
      .mockRejectedValueOnce(new Error('Database unavailable'))
      .mockRejectedValueOnce(new Error('Database unavailable'));
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(retryInterval - 1);
    expect(repository.expireStaleInquiries).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(repository.expireStaleInquiries).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(normalInterval);
    expect(repository.expireStaleInquiries).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(retryInterval);
    expect(repository.expireStaleInquiries).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(normalInterval - retryInterval);
    expect(repository.expireStaleInquiries).toHaveBeenCalledTimes(4);
  });

  it('does not overlap runs or schedule another run after shutdown', async () => {
    let finishCleanup!: (count: number) => void;
    vi.mocked(repository.expireStaleInquiries).mockReturnValueOnce(
      new Promise<number>((resolve) => { finishCleanup = resolve; }),
    );
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(normalInterval * 2);
    expect(repository.expireStaleInquiries).toHaveBeenCalledTimes(1);
    service.onApplicationShutdown();
    finishCleanup(0);
    await vi.advanceTimersByTimeAsync(normalInterval);
    expect(repository.expireStaleInquiries).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Stale inquiry cleanup diagnostics', () => {
  it.each(['42883', 'PGRST202', ''])('preserves safe error codes without leaking database details (%s)', async (code) => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code, message: 'Private database details', details: 'Private query data' },
    });
    const repository = new NotificationsRepository({ client: { rpc } } as unknown as SupabaseService);
    await expect(repository.expireStaleInquiries()).rejects.toThrow(
      `Failed to expire stale inquiries (${code || 'DATABASE_UNAVAILABLE'})`,
    );
    expect(rpc).toHaveBeenCalledWith('expire_stale_inquiries');
  });
});