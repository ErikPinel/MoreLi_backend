import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(5146),
  CORS_ORIGIN: Joi.string()
    .custom((value: string, helpers) => {
      const origins = value.split(',').map((origin) => origin.trim());
      if (
        origins.some((origin) => {
          try {
            new URL(origin);
            return false;
          } catch {
            return true;
          }
        })
      ) {
        return helpers.error('string.uri');
      }
      return value;
    })
    .default('http://localhost:5173'),
  TRUST_PROXY: Joi.boolean().truthy('true').falsy('false').default(false),
  RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(60000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(120),
  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_PUBLISHABLE_KEY: Joi.string().required(),
  SUPABASE_SECRET_KEY: Joi.string().required(),
  CLERK_ISSUER: Joi.string()
    .uri()
    .default('https://noted-caribou-6267.clerk.accounts.dev'),
  CLERK_SECRET_KEY: Joi.string().when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.optional() }),
  PUBLIC_APP_URL: Joi.string().uri().default('http://localhost:5173'),
  BREVO_API_KEY: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  BREVO_SENDER_EMAIL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().email().required(),
    otherwise: Joi.string().email().allow('').optional(),
  }),
  BREVO_SENDER_NAME: Joi.string().max(70).default('MoreLi'),
  ADMIN_NOTIFICATION_EMAIL: Joi.string()
    .email()
    .default('erik.zusin@gmail.com'),
  EMAIL_APPROVAL_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(32).required(),
    otherwise: Joi.string().min(32).allow('').optional(),
  }),
  SUPABASE_PROJECT_REF: Joi.string().optional(),
  SUPABASE_ACCESS_TOKEN: Joi.string().allow('').optional(),
  SUPABASE_DB_PASSWORD: Joi.string().allow('').optional(),
}).custom((environment, helpers) => {
  if (environment.NODE_ENV !== 'production') return environment;
  const urls = [environment.PUBLIC_APP_URL, environment.CLERK_ISSUER,
    environment.SUPABASE_URL, ...environment.CORS_ORIGIN.split(',').map((origin: string) => origin.trim())];
  if (urls.some((value: string) => {
    const url = new URL(value);
    return url.protocol !== 'https:' || url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' || url.hostname.endsWith('.local') ||
      url.hostname.endsWith('.accounts.dev') || url.username || url.password;
  })) return helpers.message({ custom: 'Production requires public HTTPS URLs and a production Clerk issuer' });
  if (!environment.CLERK_SECRET_KEY.startsWith('sk_live_')) {
    return helpers.message({ custom: 'Production requires a live Clerk secret key' });
  }
  if (!environment.CORS_ORIGIN.split(',').some((origin: string) => origin.trim() === new URL(environment.PUBLIC_APP_URL).origin)) {
    return helpers.message({ custom: 'Production CORS_ORIGIN must include PUBLIC_APP_URL origin' });
  }
  return environment;
});
