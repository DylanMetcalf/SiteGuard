// Imported first by billing.test.ts: config is read once, at import time.
process.env.TEST_WITH_BILLING = '1';
process.env.STRIPE_SECRET_KEY = 'sk_test_offline';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_offline_test_secret';
process.env.STRIPE_PRICE_HOST_STARTER = 'price_starter';
process.env.STRIPE_PRICE_HOST_PRO = 'price_pro';
process.env.STRIPE_PRICE_CONTRACTOR_PRO = 'price_contractor_pro';
