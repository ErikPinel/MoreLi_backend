import { expect, it, vi } from 'vitest';

const startup = vi.hoisted(() => {
  let finishListening: (() => void) | undefined;
  const listening = new Promise<void>((resolve) => {
    finishListening = resolve;
  });
  const config = { getOrThrow: vi.fn().mockReturnValue(5146) };
  const runner = { start: vi.fn() };
  const server = {
    once: vi.fn<(event: 'listening', listener: () => void) => void>(),
  };
  const app = {
    get: vi.fn().mockReturnValueOnce(config).mockReturnValueOnce(runner),
    getHttpServer: vi.fn().mockReturnValue(server),
    listen: vi.fn().mockReturnValue(listening),
    enableShutdownHooks: vi.fn(),
  };
  return {
    app,
    config,
    runner,
    server,
    configureApp: vi.fn(),
    loggerError: vi.fn(),
    finishListening: () => {
      if (!finishListening) throw new Error('Listening fixture was not initialized');
      finishListening();
    },
  };
});

vi.mock('@nestjs/common', () => ({ Logger: { error: startup.loggerError } }));
vi.mock('@nestjs/config', () => ({ ConfigService: class {} }));
vi.mock('@nestjs/core', () => ({
  NestFactory: { create: vi.fn().mockResolvedValue(startup.app) },
}));
vi.mock('./app.module.js', () => ({ AppModule: class {} }));
vi.mock('./app.setup.js', () => ({ configureApp: startup.configureApp }));
vi.mock('./email/email-delivery-runner.js', () => ({
  EmailDeliveryRunner: class {},
}));

it('finishes entrypoint loading before listening and starts delivery on the server event', async () => {
  let imported = false;
  const moduleReady = import('./main.js').then(() => {
    imported = true;
  });

  try {
    await vi.waitFor(() => {
      expect(startup.app.listen).toHaveBeenCalledWith(5146);
    }, { timeout: 1000 });
    await vi.waitFor(() => {
      expect(imported).toBe(true);
    }, { timeout: 1000 });

    expect(startup.configureApp).toHaveBeenCalledWith(startup.app, startup.config);
    expect(startup.app.enableShutdownHooks).toHaveBeenCalledOnce();
    expect(startup.runner.start).not.toHaveBeenCalled();

    const onListening = startup.server.once.mock.calls.find(([event]) => event === 'listening')?.[1];
    if (!onListening) throw new Error('Bootstrap did not register the listening event');
    onListening();

    expect(startup.runner.start).toHaveBeenCalledOnce();
  } finally {
    startup.finishListening();
    await moduleReady;
  }

  expect(startup.runner.start).toHaveBeenCalledOnce();
  expect(startup.loggerError).not.toHaveBeenCalled();
});
