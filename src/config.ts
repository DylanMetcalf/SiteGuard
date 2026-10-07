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
  /** Public base URL, used in emails and share links, e.g. https://app.comvera.co.za */
  // On Render, the service's own URL is used until a custom domain is set.
  APP_URL: z.string().url().default(process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'),
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
  /** Optional explicit server-side encryption, e.g. "AES256" or "aws:kms". */
  S3_SSE: z.enum(['AES256', 'aws:kms']).optional(),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(20),

  // Email: SMTP connection URL, e.g. smtps://user:pass@smtp.postmarkapp.com:465.
  // Unset → emails are written to the log (and still recorded in the outbox).
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('COMVERA <no-reply@comvera.local>'),
  /** Where "Report a problem" messages are emailed (e.g. your own address). Unset → logged only. */
  SUPPORT_EMAIL: z.string().email().optional(),
  /** Shown on the public contact page, e.g. +27 82 000 0000. Unset → email and form only. */
  CONTACT_PHONE: z.string().max(40).optional(),
  /** Comma-separated emails of the people who run this service; they see the platform overview (More → Platform). */
  PLATFORM_ADMIN_EMAILS: z.string().default(''),

  // AI drafting via server-side proxy. Unset → AI features are hidden.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  /** Monthly AI request allowance per organisation on plans that include AI. */
  AI_MONTHLY_REQUEST_LIMIT: z.coerce.number().int().positive().default(300),
  /** Let the assistant search the web when researching site requirements. */
  AI_WEB_SEARCH: bool(true),

  // Billing. Unset → billing is disabled and every organisation is treated as in good standing.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_HOST_STARTER: z.string().optional(),
  STRIPE_PRICE_HOST_PRO: z.string().optional(),
  STRIPE_PRICE_CONTRACTOR_PRO: z.string().optional(),
  STRIPE_PRICE_CONTRACTOR_STARTER: z.string().optional(),

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

// A setting saved as an empty box (e.g. left blank in Render) means "not set", so defaults apply.
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ''));
const parsed = schema.safeParse(env);
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
if (isProd) {
  if (config.APP_URL.startsWith('http://localhost')) console.warn('APP_URL is not set: links in emails will point at localhost.');
  if (!config.SMTP_URL) console.warn('SMTP_URL is not set: emails are written to the log instead of being sent.');
}
export const features = {
  ai: !!config.ANTHROPIC_API_KEY,
  billing: !!config.STRIPE_SECRET_KEY,
  email: !!config.SMTP_URL,
  demo: config.DEMO_SANDBOX_ENABLED,
  devRoleSwitcher: config.DEV_ROLE_SWITCHER && !isProd,
};

const platformAdmins = new Set(config.PLATFORM_ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
/** Platform admins must also have confirmed their email, so nobody can claim the address by signing up first. */
export function isPlatformAdmin(user: { email: string; email_verified_at: unknown; is_demo?: boolean }): boolean {
  return !user.is_demo && !!user.email_verified_at && platformAdmins.has(user.email.toLowerCase());
}
