export default () => ({
  app: {
    port: Number.parseInt(process.env.PORT ?? '3000', 10),
    corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim()),
    trustProxy: process.env.TRUST_PROXY === 'true',
    rateLimitWindowMs: Number.parseInt(
      process.env.RATE_LIMIT_WINDOW_MS ?? '60000',
      10,
    ),
    rateLimitMax: Number.parseInt(process.env.RATE_LIMIT_MAX ?? '120', 10),
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    secretKey: process.env.SUPABASE_SECRET_KEY,
  },
});
