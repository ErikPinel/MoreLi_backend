import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service.js';
import { IdentityService } from './identity.service.js';

describe('Verified contact identity', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('logs only upstream status without credentials or user data on provider failure', async () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const service = new IdentityService(new ConfigService({ clerk: { secretKey: 'secret-test-only' } }), {} as SupabaseService);
    await expect(service.verifiedEmail({ sub: 'internal', externalSubject: 'private-user-id', identityProvider: 'clerk' })).rejects.toThrow('Account provider request failed');
    expect(log).toHaveBeenCalledWith('Clerk request failed: method=GET, status=429');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-test-only');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-user-id');
  });

  it('uses only the verified Clerk primary email', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      primary_email_address_id: 'primary',
      email_addresses: [
        { id: 'other', email_address: 'other@example.com', verification: { status: 'verified' } },
        { id: 'primary', email_address: 'OWNER@example.com', verification: { status: 'verified' } },
      ],
    }) });
    vi.stubGlobal('fetch', fetchMock);
    const service = new IdentityService(new ConfigService({ clerk: { secretKey: 'test-only' } }), {} as SupabaseService);
    await expect(service.verifiedEmail({ sub: 'internal', externalSubject: 'user_1', identityProvider: 'clerk' })).resolves.toBe('owner@example.com');
  });

  it('fails closed without server provider credentials', async () => {
    const service = new IdentityService(new ConfigService({}), {} as SupabaseService);
    await expect(service.verifiedEmail({ sub: 'internal', externalSubject: 'user_1', identityProvider: 'clerk' })).rejects.toThrow('not configured');
  });

  it('rejects an unverified primary email', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      primary_email_address_id: 'primary', email_addresses: [{ id: 'primary', email_address: 'owner@example.com', verification: { status: 'unverified' } }],
    }) }));
    const service = new IdentityService(new ConfigService({ clerk: { secretKey: 'test-only' } }), {} as SupabaseService);
    await expect(service.verifiedEmail({ sub: 'internal', externalSubject: 'user_1', identityProvider: 'clerk' })).rejects.toMatchObject({
      status: 403,
      response: { code: 'EMAIL_VERIFICATION_REQUIRED' },
    });
  });

  it('requires verification when Clerk has no primary email', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ primary_email_address_id: null, email_addresses: [] }) }));
    const service = new IdentityService(new ConfigService({ clerk: { secretKey: 'test-only' } }), {} as SupabaseService);
    await expect(service.verifiedEmail({ sub: 'internal', externalSubject: 'user_1', identityProvider: 'clerk' })).rejects.toMatchObject({
      status: 403,
      response: { code: 'EMAIL_VERIFICATION_REQUIRED' },
    });
  });
});