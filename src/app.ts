import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { config, isProd } from './config.js';
import { HttpError } from './lib/errors.js';
import type { Ctx } from './lib/authz.js';
import { renewCookie, resolveSession, SESSION_COOKIE } from './lib/sessions.js';
import { safeEqual } from './lib/security.js';
import authRoutes from './routes/auth.js';
import orgRoutes from './routes/org.js';
import bootstrapRoutes from './routes/bootstrap.js';
import siteRoutes from './routes/sites.js';
import documentRoutes from './routes/documents.js';
import safetyRoutes from './routes/safety.js';
import requestRoutes from './routes/requests.js';
import fileRoutes from './routes/files.js';
import { pool } from './db/pool.js';
import aiRoutes from './routes/ai.js';
import assistantRoutes from './routes/assistant.js';
import agentRoutes from './routes/agent.js';
import supportRoutes from './routes/support.js';
import studioRoutes from './routes/studio.js';
import reviewRoutes from './routes/review.js';
import joinRoutes from './routes/join.js';
import workplaceRoutes from './routes/workplaces.js';
import gateRoutes from './routes/gate.js';
import oversightRoutes from './routes/oversight.js';
import projectRoutes from './routes/projects.js';
import billingRoutes from './routes/billing.js';
import shareRoutes from './routes/share.js';
import legalRoutes from './routes/legal.js';
import eventRoutes from './routes/events.js';
import demoRoutes from './routes/demo.js';
import workforceRoutes from './routes/workforce.js';

declare module 'fastify' {
  interface FastifyRequest {
    ctx: Ctx | null;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../public');

/** Paths that authenticate some other way (e.g. Stripe signature) and skip CSRF checks. */
const CSRF_EXEMPT = new Set(['/api/billing/webhook']);

const FIELD_LABELS: Record<string, string> = {
  email: 'Email address', password: 'Password', name: 'Name', orgName: 'Organisation name', orgKind: 'Organisation type',
  location: 'Location', category: 'Category', why: 'Reason', note: 'Note', message: 'Message', title: 'Title', description: 'Description',
  expiryDate: 'Expiry date', dueDate: 'Due date', date: 'Date', brandColor: 'Brand colour', docPrefix: 'Document number prefix',
  contactEmail: 'Contact email', phone: 'Phone number', role: 'Role', type: 'Type', values: 'Answers', messages: 'Message',
};
/** Turns a validation issue into a sentence a site supervisor understands. */
function humanIssue(issue: { path: PropertyKey[]; message: string; code?: string; minimum?: unknown; maximum?: unknown; format?: string } | undefined): string {
  if (!issue) return 'Please check the form and try again.';
  const key = [...issue.path].reverse().find((k) => typeof k === 'string') as string | undefined;
  const label = (key && FIELD_LABELS[key]) || (key ? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) : 'This field');
  if (issue.format === 'email' || /email/i.test(issue.message)) return 'Enter a valid email address, like name@company.co.za.';
  if (issue.code === 'too_small') return Number(issue.minimum) <= 1 ? `${label} is required.` : `${label} must be at least ${String(issue.minimum)} characters.`;
  if (issue.code === 'too_big') return `${label} is too long (${String(issue.maximum)} characters at most).`;
  if (issue.code === 'invalid_value' || issue.code === 'invalid_enum_value') return `Choose a valid ${label.toLowerCase()}.`;
  if (issue.code === 'invalid_type') return `${label} is required.`;
  if (issue.code === 'invalid_format' || issue.code === 'invalid_string') return `${label} isn't in the right format.`;
  return `${label}: ${issue.message}`;
}

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? !['test'].includes(config.NODE_ENV),
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'", 'https://checkout.stripe.com', 'https://billing.stripe.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: isProd ? [] : null,
      },
    },
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10 },
  });

  app.decorateRequest('ctx', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    req.ctx = await resolveSession(req.cookies[SESSION_COOKIE], req);
    if (req.ctx === null && req.cookies[SESSION_COOKIE]) reply.clearCookie(SESSION_COOKIE, { path: '/' });
    if (req.ctx?.renewedUntil) renewCookie(reply, req.cookies[SESSION_COOKIE]!, req.ctx.renewedUntil);

    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const pathOnly = req.url.split('?')[0];
    if (!mutating || CSRF_EXEMPT.has(pathOnly)) return;
    if (req.ctx) {
      // Double-submit token bound to the session.
      const header = req.headers['x-csrf-token'];
      if (typeof header !== 'string' || !safeEqual(header, req.ctx.csrfToken)) {
        throw new HttpError(403, 'csrf', 'Your session token is stale — refresh the page and try again.');
      }
    } else {
      // Anonymous writes (sign-in, sign-up, reset) must be JSON, which forces a CORS preflight cross-origin.
      const type = req.headers['content-type'] ?? '';
      if (!type.startsWith('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Expected JSON.');
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'invalid', message: humanIssue(err.issues[0]), issues: err.issues });
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: 'rate_limited', message: 'Too many attempts — wait a minute and try again.' });
    }
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ error: 'too_large', message: `File is too large (${config.MAX_UPLOAD_MB}MB max).` });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: 'bad_request', message: e.message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'server_error', message: 'Something went wrong on our side. Try again.' });
  });

  // Liveness plus a database round trip, for the host's health check and uptime monitoring.
  app.get('/healthz', async (_req, reply) => {
    try {
      await pool.query('select 1');
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false, error: 'database_unavailable' });
    }
  });

  await app.register(authRoutes);
  await app.register(orgRoutes);
  await app.register(bootstrapRoutes);
  await app.register(siteRoutes);
  await app.register(documentRoutes);
  await app.register(safetyRoutes);
  await app.register(requestRoutes);
  await app.register(fileRoutes);
  await app.register(aiRoutes);
  await app.register(assistantRoutes);
  await app.register(agentRoutes);
  await app.register(supportRoutes);
  await app.register(studioRoutes);
  await app.register(reviewRoutes);
  await app.register(joinRoutes);
  await app.register(workplaceRoutes);
  await app.register(gateRoutes);
  await app.register(oversightRoutes);
  await app.register(projectRoutes);
  await app.register(billingRoutes);
  await app.register(shareRoutes);
  await app.register(legalRoutes);
  await app.register(eventRoutes);
  await app.register(demoRoutes);
  await app.register(workforceRoutes);

  await app.register(fastifyStatic, { root: publicDir, index: false, wildcard: false });

  // Single-page app shell for every non-API route.
  const sendShell = async (_req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    reply.header('cache-control', 'no-cache');
    return reply.sendFile('index.html');
  };
  app.get('/', sendShell);
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET') {
      return reply.status(404).send({ error: 'not_found', message: 'Not found.' });
    }
    if (path.extname(req.url.split('?')[0])) return reply.status(404).send('Not found');
    return sendShell(req, reply);
  });

  return app;
}
