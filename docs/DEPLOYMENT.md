# Deployment

SiteGuard is one stateless Docker image plus four managed services: Postgres, S3-compatible
storage, an SMTP provider, and Stripe. Migrations run automatically on start, guarded by an advisory
lock, so rolling deploys with several replicas are safe.

## Recommended hosting

The customers are South African mines and contractors, so latency and data residency matter. Two
sensible paths are below. Check each provider's regional availability when you set up, because
these offerings change.

**A. Fastest to production (recommended to start):**

| Need | Service |
|---|---|
| App | **Fly.io** (Johannesburg region) or **Render**, running the Dockerfile |
| Postgres | Managed Postgres in or near South Africa, with daily backups and point-in-time recovery |
| Files | **Cloudflare R2**: S3-compatible with no egress fees, which suits people downloading safety files |
| Email | **Postmark** or **Resend** over SMTP. Set up SPF, DKIM and DMARC on your sending domain. |
| Billing | **Stripe** (confirm availability for your legal entity; the billing code is isolated in `src/routes/billing.ts`) |

**B. Enterprise / data residency in South Africa:** AWS **af-south-1 (Cape Town)**: ECS Fargate for
the app, RDS for PostgreSQL, S3 for files, and SES or Postmark for email. Choose this when a mining
house's procurement requires in-country hosting.

A single small instance (1 vCPU, 1 GB RAM) and the smallest managed Postgres comfortably serve the
first dozens of organisations. Scale out horizontally; nothing is held in memory except rate-limit
counters (see ARCHITECTURE → Known limits).

## Environment

See [`.env.example`](../.env.example) for everything. The production minimum:

```
NODE_ENV=production
APP_URL=https://app.yourdomain.co.za
DATABASE_URL=postgres://...
DATABASE_SSL=true
TRUST_PROXY=true                 # behind Fly/Render/ALB, so rate limits see real client IPs
STORAGE_DRIVER=s3
S3_BUCKET=siteguard-documents
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # omit for AWS S3
S3_REGION=auto                   # or af-south-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
SMTP_URL=smtps://USER:PASS@smtp.postmarkapp.com:465
EMAIL_FROM=SiteGuard <no-reply@yourdomain.co.za>
ANTHROPIC_API_KEY=...            # optional; enables AI drafting and expiry detection
STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... STRIPE_PRICE_*=...   # optional; enables billing
```

## Stripe setup

1. Create three recurring products, each priced **per seat** (the quantity is the seat count):
   - **Site Starter**: up to 5 active sites, no AI.
   - **Site Professional**: unlimited sites, AI, share links.
   - **Contractor Pro**: AI, share links, more seats.

   Put their price IDs in `STRIPE_PRICE_HOST_STARTER`, `STRIPE_PRICE_HOST_PRO` and
   `STRIPE_PRICE_CONTRACTOR_PRO`. Plan limits live in `src/lib/plans.ts`.
2. Add a webhook endpoint at `https://<APP_URL>/api/billing/webhook` for
   `checkout.session.completed` and `customer.subscription.created`, `.updated` and `.deleted`. Put
   its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Configure the **Customer Portal**. Allow payment-method updates, invoices and cancellation.
   Plan and seat changes happen inside SiteGuard (`POST /api/billing/change`), which checks that
   the new plan fits the organisation's current seats and sites.

Without Stripe keys, billing is off: no trial countdown, and no seat or site limits. That is handy
for pilots.

## Storage

Create a private bucket with no public access. SiteGuard never exposes bucket URLs. For R2, create
an API token scoped to the one bucket. Object keys are `<orgId>/<yyyy-mm>/<uuid>.<ext>`. Turn on
bucket versioning or lifecycle backups if your retention policy requires them.

## Go-live checklist

- [ ] `APP_URL` is the public HTTPS URL. Email links and share links are built from it.
- [ ] `TRUST_PROXY=true` behind a proxy or load balancer.
- [ ] Database backups plus a tested restore. Enable point-in-time recovery.
- [ ] SPF, DKIM and DMARC for the email domain, and a test of the password-reset email.
- [ ] Stripe webhook shows successful deliveries. Test a subscription in Stripe test mode first.
- [ ] Decide on `DEMO_SANDBOX_ENABLED` for production (it's a good sales tool; sandboxes self-delete).
- [ ] `DEV_ROLE_SWITCHER` unset. The server refuses to start in production with it on.
- [ ] Uptime check on `/healthz`, and error alerting on 5xx in the logs.
- [ ] Review the requirement templates and appointment presets with a SHE/legal advisor before
      selling to a customer.
- [ ] Privacy policy and terms (POPIA): what's collected, the processors used (hosting, email,
      Stripe, Anthropic for AI drafting), and retention.

## Running locally with the full stack

```bash
docker compose up -d                    # Postgres, MinIO (+ bucket), Mailpit
cat >> .env <<'EOF'
STORAGE_DRIVER=s3
S3_BUCKET=siteguard-documents
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=siteguard
S3_SECRET_ACCESS_KEY=siteguard-secret
SMTP_URL=smtp://localhost:1025
EOF
npm run dev
```
