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
  RESEND_API_KEY: 're_test_fixture',
  RESEND_FROM_EMAIL: 'sender@example.com',
  RESEND_WEBHOOK_SECRET: 'whsec_test_fixture_at_least_20_chars',
  EMAIL_APPROVAL_SECRET: 'test-approval-secret-with-at-least-32-characters',
};

const initialDeployment = {
  ...production,
  PUBLIC_APP_URL: 'https://moreli-client.vercel.app',
  CORS_ORIGIN: 'https://moreli-client.vercel.app',
  CLERK_ISSUER: 'https://noted-caribou-6267.clerk.accounts.dev',
  CLERK_SECRET_KEY: 'sk_test_fixture',
  CLERK_ALLOW_DEVELOPMENT_INSTANCE: true,
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
    expect(envValidationSchema.validate(production).value.CLERK_ALLOW_DEVELOPMENT_INSTANCE).toBe(false);
  });
  it.each([true, 'true'])('accepts the initial deployment only with the explicit opt-in %j', (optIn) => {
    expect(envValidationSchema.validate({
      ...initialDeployment,
      CLERK_ALLOW_DEVELOPMENT_INSTANCE: optIn,
    }).error).toBeUndefined();
  });
  it.each([false, 'false', undefined, 'invalid'])('rejects development Clerk without a valid opt-in %j', (optIn) => {
    expect(envValidationSchema.validate({
      ...initialDeployment,
      CLERK_ALLOW_DEVELOPMENT_INSTANCE: optIn,
    }).error).toBeDefined();
  });
  it('continues to accept production Clerk when the opt-in is enabled', () => {
    expect(envValidationSchema.validate({
      ...production,
      CLERK_ALLOW_DEVELOPMENT_INSTANCE: true,
    }).error).toBeUndefined();
  });
  it('accepts the reported deployment URLs including the trailing Supabase slash', () => {
    expect(envValidationSchema.validate({
      ...initialDeployment,
      SUPABASE_URL: 'https://whzrmgntqsinkxfqymqz.supabase.co/',
    }).error).toBeUndefined();
  });
  it.each([
    { name: 'PUBLIC_APP_URL', value: 'http://localhost:5173' },
    { name: 'SUPABASE_URL', value: 'https://user:private-fixture-value@example.supabase.co' },
    { name: 'CORS_ORIGIN', value: 'https://moreli-client.vercel.app,http://localhost:5173' },
  ])('identifies invalid URL field $name without exposing its value', ({ name, value }) => {
    const { error } = envValidationSchema.validate({
      ...initialDeployment,
      [name]: value,
    });

    expect(error?.message).toBe(`Production requires public HTTPS URLs for: ${name}`);
    expect(error?.message).not.toContain(value);
    expect(error?.message).not.toContain('private-fixture-value');
  });
  it('identifies every invalid public URL field in one error', () => {
    const { error } = envValidationSchema.validate({
      ...initialDeployment,
      PUBLIC_APP_URL: 'http://localhost:5173',
      SUPABASE_URL: 'http://example.supabase.co',
      CORS_ORIGIN: 'http://localhost:5173',
    });

    expect(error?.message).toBe('Production requires public HTTPS URLs for: PUBLIC_APP_URL, SUPABASE_URL, CORS_ORIGIN');
  });
  it('identifies missing settings that fall back to local development URLs', () => {
    const { error } = envValidationSchema.validate({
      ...initialDeployment,
      PUBLIC_APP_URL: undefined,
      CORS_ORIGIN: undefined,
    });

    expect(error?.message).toBe('Production requires public HTTPS URLs for: PUBLIC_APP_URL, CORS_ORIGIN');
  });
  it.each([
    { CLERK_SECRET_KEY: 'sk_live_fixture' },
    { CLERK_ISSUER: 'https://clerk.example.com' },
    { CLERK_ISSUER: 'http://noted-caribou-6267.clerk.accounts.dev' },
    { CLERK_ISSUER: 'https://localhost' },
    { CLERK_ISSUER: 'https://127.0.0.1' },
    { CLERK_ISSUER: 'https://clerk.local' },
    { CLERK_ISSUER: 'https://user:password@fixture.clerk.accounts.dev' },
    { PUBLIC_APP_URL: 'http://localhost:5173' },
    { PUBLIC_APP_URL: 'https://fixture.clerk.accounts.dev' },
    { SUPABASE_URL: 'http://example.supabase.co' },
    { SUPABASE_URL: 'https://fixture.clerk.accounts.dev' },
    { CORS_ORIGIN: 'https://moreli-client.vercel.app,http://localhost:5173' },
    { CORS_ORIGIN: 'https://moreli-client.vercel.app,https://fixture.clerk.accounts.dev' },
    { CORS_ORIGIN: 'https://wrong.example.com' },
    { RESEND_FROM_EMAIL: 'onboarding@resend.dev' },
    { RESEND_API_KEY: '' },
    { RESEND_WEBHOOK_SECRET: '' },
    { EMAIL_APPROVAL_SECRET: '' },
  ])('keeps other production requirements enforced with development Clerk %j', (override) => {
    expect(envValidationSchema.validate({
      ...initialDeployment,
      ...override,
    }).error).toBeDefined();
  });
  it.each([
    { PUBLIC_APP_URL: 'http://localhost:5173' },
    { CLERK_ISSUER: 'https://fixture.clerk.accounts.dev' },
    { CLERK_SECRET_KEY: 'sk_test_fixture' },
    { CORS_ORIGIN: 'https://wrong.example.com' },
    { RESEND_FROM_EMAIL: 'onboarding@resend.dev' },
    { RESEND_API_KEY: '' },
    { RESEND_WEBHOOK_SECRET: '' },
  ])('rejects unsafe deployment settings %j', (override) => {
    expect(envValidationSchema.validate({ ...production, ...override }).error).toBeDefined();
  });
});