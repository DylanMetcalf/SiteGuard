// Imported first by enforce.test.ts: plans enforced, no payment provider configured.
process.env.ENFORCE_PLANS = 'true';
delete process.env.STRIPE_SECRET_KEY;
