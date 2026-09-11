import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
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
  SUPABASE_PROJECT_REF: Joi.string().optional(),
  SUPABASE_ACCESS_TOKEN: Joi.string().allow('').optional(),
  SUPABASE_DB_PASSWORD: Joi.string().allow('').optional(),
});
