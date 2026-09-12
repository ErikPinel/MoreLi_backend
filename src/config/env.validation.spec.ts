import { describe, expect, it, vi } from 'vitest';
import { envValidationSchema } from './env.validation.js';
import configuration from './configuration.js';

const production = {
  NODE_ENV: 'production',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-public',
  SUPABASE_SECRET_KEY: 'test-secret',
  CLERK_ISSUER: 'https://clerk.example.com',
  CLERK_SECRET_KEY: 'sk_live_fixture',
  PUBLIC_APP_URL: 'https://example.com',
  CORS_ORIGIN: 'https://example.com',
  BREVO_API_KEY: 'test-brevo',
  BREVO_SENDER_EMAIL: 'sender@example.com',
  EMAIL_APPROVAL_SECRET: 'test-approval-secret-with-at-least-32-characters',
};

describe('production environment', () => {
  it('defaults to API port 5146 and respects explicit port overrides', () => {
    vi.stubEnv('PORT', undefined);
    try {
      expect(configuration().app.port).toBe(5146);
      expect(envValidationSchema.validate(production).value.PORT).toBe(5146);
      vi.stubEnv('PORT', '6146');
      expect(configuration().app.port).toBe(6146);
      expect(envValidationSchema.validate({ ...production, PORT: 6146 }).value.PORT).toBe(6146);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('accepts explicit HTTPS production services', () => {
    expect(envValidationSchema.validate(production).error).toBeUndefined();
  });
  it.each([
    { PUBLIC_APP_URL: 'http://localhost:5173' },
    { CLERK_ISSUER: 'https://fixture.clerk.accounts.dev' },
    { CLERK_SECRET_KEY: 'sk_test_fixture' },
    { CORS_ORIGIN: 'https://wrong.example.com' },
  ])('rejects unsafe deployment settings %j', (override) => {
    expect(envValidationSchema.validate({ ...production, ...override }).error).toBeDefined();
  });
});