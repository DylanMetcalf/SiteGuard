/**
 * Security events go to the server log as structured lines ({ security: '<event>', ... }), which the
 * hosting platform keeps outside the application's database, so a compromised application cannot
 * quietly erase them. Never log passwords, tokens, codes or document contents; people are identified
 * by id, or by a short one-way hash of the email when no account matched.
 */
import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';

export type SecurityEvent =
  | 'login_failed' | 'login_locked' | 'login_succeeded' | 'password_reset_requested' | 'password_reset_completed'
  | 'password_changed' | 'sessions_revoked' | 'mfa_failed' | 'mfa_verified' | 'mfa_enrolled'
  | 'csrf_rejected' | 'rate_limited' | 'webhook_bad_signature' | 'upload_rejected_infected' | 'upload_scan_unavailable';

export const emailRef = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 12);

export function securityEvent(req: FastifyRequest, event: SecurityEvent, fields: Record<string, string | number | boolean | null | undefined> = {}) {
  req.log.warn({ security: event, ip: req.ip, userId: req.ctx?.user.id ?? fields.userId ?? null, ...fields }, `security: ${event}`);
}
