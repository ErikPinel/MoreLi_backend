export default () => ({
  app: {
    port: Number.parseInt(process.env.PORT ?? '5146', 10),
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
  clerk: {
    secretKey: process.env.CLERK_SECRET_KEY,
    issuer:
      process.env.CLERK_ISSUER ??
        'https://noted-caribou-6267.clerk.accounts.dev',
  },
  email: {
    brevoApiKey: process.env.BREVO_API_KEY,
    senderEmail: process.env.BREVO_SENDER_EMAIL,
    senderName: process.env.BREVO_SENDER_NAME ?? 'MoreLi',
    adminEmail: process.env.ADMIN_NOTIFICATION_EMAIL ?? 'erik.zusin@gmail.com',
    approvalSecret: process.env.EMAIL_APPROVAL_SECRET,
  },
  publicAppUrl: process.env.PUBLIC_APP_URL ?? 'http://localhost:5173',
});
