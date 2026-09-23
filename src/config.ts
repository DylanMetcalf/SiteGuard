import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  /** Public base URL, used in emails and share links, e.g. https://app.siteguard.co.za */
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().default('postgres://siteguard:siteguard@localhost:5432/siteguard'),
  DATABASE_SSL: bool(false),
  /** Trust X-Forwarded-* headers (set when behind a load balancer / proxy). */
  TRUST_PROXY: bool(false),

  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),

  // Storage: "s3" for any S3-compatible store (AWS S3, Cloudflare R2, MinIO), "local" for dev.
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('.data/uploads'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(false),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(20),

  // Email: SMTP connection URL, e.g. smtps://user:pass@smtp.postmarkapp.com:465.
  // Unset → emails are written to the log (and still recorded in the outbox).
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('SiteGuard <no-reply@siteguard.local>'),

  // AI drafting via server-side proxy. Unset → AI features are hidden.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  /** Monthly AI request allowance per organisation on plans that include AI. */
  AI_MONTHLY_REQUEST_LIMIT: z.coerce.number().int().positive().default(300),

  // Billing. Unset → billing is disabled and every organisation is treated as in good standing.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_HOST_STARTER: z.string().optional(),
  STRIPE_PRICE_HOST_PRO: z.string().optional(),
  STRIPE_PRICE_CONTRACTOR_PRO: z.string().optional(),

  /** Allow creating throwaway demo sandboxes from the sign-in page. */
  DEMO_SANDBOX_ENABLED: bool(true),
  /**
   * QA only: lets any signed-in session switch into any demo persona. Refused in production.
   * Persona switching inside a demo sandbox works without this flag.
   */
  DEV_ROLE_SWITCHER: bool(false),

  /** Run the email + reminder background jobs inside the web process. */
  RUN_JOBS_IN_WEB: bool(true),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

if (config.NODE_ENV === 'production' && config.DEV_ROLE_SWITCHER) {
  console.error('DEV_ROLE_SWITCHER must not be enabled in production.');
  process.exit(1);
}
if (config.STORAGE_DRIVER === 's3' && !config.S3_BUCKET) {
  console.error('STORAGE_DRIVER=s3 requires S3_BUCKET.');
  process.exit(1);
}

export const isProd = config.NODE_ENV === 'production';
export const features = {
  ai: !!config.ANTHROPIC_API_KEY,
  billing: !!config.STRIPE_SECRET_KEY,
  email: !!config.SMTP_URL,
  demo: config.DEMO_SANDBOX_ENABLED,
  devRoleSwitcher: config.DEV_ROLE_SWITCHER && !isProd,
};
