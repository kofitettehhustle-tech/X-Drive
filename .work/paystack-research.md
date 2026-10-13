# Paystack integration notes (2026-10-13)

Primary sources consulted:
- https://paystack.com/docs/api/transaction/
- https://paystack.com/docs/payments/accept-payments/
- https://paystack.com/docs/payments/verify-payments/
- https://paystack.com/docs/payments/webhooks/

Implementation facts:
- Initialize with `POST /transaction/initialize` from the backend using `Authorization: Bearer <secret>`. The amount is in the currency's subunit; the response provides a hosted `authorization_url` and transaction `reference`.
- Verify with `GET /transaction/verify/:reference`. Only `data.status === 'success'` is a successful payment; also compare returned reference, amount, and currency with the server's pending payment record.
- A browser callback is not proof of payment. Use server-side verify and a signed webhook.
- The webhook header is `x-paystack-signature`, an HMAC-SHA512 over the raw request body signed with the Paystack secret. Acknowledge valid events promptly and make settlement idempotent because events may be retried.
- In the current implementation, payment initialization will be disabled by default and constrained to test-key configuration; no real supplier fulfillment will occur.
