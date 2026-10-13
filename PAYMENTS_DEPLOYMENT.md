# X-Drive PostgreSQL and Paystack test setup

## Safety state

- When `DATABASE_URL` is configured, the backend uses Supabase PostgreSQL and creates the required schema on startup. Without it, local development continues to use SQLite.
- Paystack remains restricted to **test mode**. Do not use a live secret key.
- Verified payments are recorded, but **real supplier fulfillment stays disabled**.
- Wallet-funded service orders remain disabled (`XDRIVE_WALLET_PAYMENTS_ENABLED=false`). Wallet deposits can be tested separately.
- Direct unpaid order submission is blocked; checkout must go through the payment-gated routes.
- Never put the database URL or `PAYSTACK_SECRET_KEY` in frontend files, GitHub Pages/Vercel settings, chat messages, or a public repository.

## 1. Create a Supabase project

1. In Supabase, create a project on the Free plan. Choose a region close to the Render service and save the database password privately.
2. In the project dashboard, open **Connect** and select the **Session pooler** connection method for Render’s IPv4-compatible outbound connection.
3. Copy the complete URI shown by Supabase. Do not edit or share it in chat. It contains credentials and belongs only on the backend.
4. The application creates its PostgreSQL tables and indexes automatically on first startup. No manual SQL migration or SQLite import is needed because this rollout starts with an empty customer/order/wallet database.

Supabase connection documentation: <https://supabase.com/docs/guides/database/connecting-to-postgres>

## 2. Add backend variables in Render

Open the Render web service’s **Environment** settings and add each variable as its own name/value entry. Mark secrets as secret. Do not paste a multiline block into a single value.

| Variable | Value |
|---|---|
| `DATABASE_URL` | The complete Supabase **Session pooler** URI (secret) |
| `PAYSTACK_SECRET_KEY` | A Paystack **test** secret beginning `sk_test_` (secret) |
| `XDRIVE_PAYSTACK_MODE` | `test` |
| `XDRIVE_PAYMENTS_ENABLED` | Leave `false` until the backend is deployed and verified; then `true` enables test checkout only |
| `XDRIVE_PAYMENT_CURRENCY` | `USD` |
| `XDRIVE_PAYSTACK_CALLBACK_URL` | Full HTTPS URL to `payment-result.html` on the deployed frontend |
| `XDRIVE_ALLOWED_ORIGINS` | Exact frontend origin(s), comma-separated, with no path or trailing slash |
| `XDRIVE_DEPOSIT_MIN_MINOR` | `100` ($1.00) |
| `XDRIVE_DEPOSIT_MAX_MINOR` | `500000` ($5,000.00) |
| `XDRIVE_WALLET_PAYMENTS_ENABLED` | `false` |

`DATABASE_URL` takes precedence over `XDRIVE_DATABASE_PATH`. Do not set it on a static frontend host, and never put a real value in `.env.example` or commit it to the repository; keep only the blank placeholder there. Only the backend needs the database password; this server-to-database connection does not require exposing a Supabase public/anon key to the storefront.

If the frontend is hosted under a GitHub Pages project path, include that path in the callback URL, for example `https://OWNER.github.io/REPOSITORY/payment-result.html`; the origin still contains only `https://OWNER.github.io`. For Vercel, use the actual frontend host and add that exact origin to `XDRIVE_ALLOWED_ORIGINS`.

## 3. Deploy and verify

1. Set Render’s Root Directory to the repository root and Start Command to `npm start`. The backend requires Node.js 22.13 or newer.
2. Deploy the PostgreSQL changes. Watch the Render logs for schema initialization errors. If the database URL is invalid or the database cannot be reached, the backend will not start serving API traffic.
3. After the deployment is healthy, check `GET https://x-drive-ams0.onrender.com/api/security/config`. Before test checkout is enabled, confirm `livePaymentsEnabled: false`, `realFulfillmentEnabled: false`, and `walletOrderPaymentsEnabled: false`.
4. Confirm the catalog loads from MoreThanPanel, then test account registration/login and guest checkout. Use Paystack’s test environment/test payment details only.
5. Test a wallet deposit only after test checkout works. Verify the balance and ledger after the backend has confirmed settlement. Wallet orders must remain disabled.
6. Confirm a successful test order is recorded as paid but remains locally pending; no supplier order is submitted. Guest tracking requires the order ID and its private token.

Only after the Supabase connection and backend routes are verified should you set `XDRIVE_PAYMENTS_ENABLED=true`; the code still rejects live-mode settings and never enables real fulfillment. Do not enable production payment credentials as a workaround for a failed test.

## Supabase Free considerations

Supabase Free has usage limits and projects may pause after inactivity. Review the current plan limits and recovery/backup options before relying on it for important customer balances or payment history: <https://supabase.com/pricing>. Treat the Free project as a test deployment, keep provider payment reconciliation records, and do not promise persistent production wallet availability until the storage plan and backup requirements are suitable.
