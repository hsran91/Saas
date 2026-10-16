# Stripe Connect setup

The application uses Stripe Connect Express accounts so each care provider receives payments in its own Stripe account. Stripe credentials are server-only; never put them in frontend files, browser storage, source control, or chat.

## Configure the platform

1. Enable Stripe Connect for the platform Stripe account.
2. Create a restricted API key for the platform and grant the minimum permissions required by the app: read and write access to Accounts, write access to Account Links, Checkout Sessions, and Refunds. The key is used only by the backend.
3. Configure the backend environment:
   - `STRIPE_SECRET_KEY`: the platform restricted key.
   - `STRIPE_WEBHOOK_SECRET`: signing secret for the webhook endpoint.
   - `APP_BASE_URL`: public base URL serving the frontend, without a path.
   - `STRIPE_CONNECT_DEFAULT_COUNTRY`: two-letter country code for new connected accounts (defaults to `US`).
4. Register `POST https://<your-app-host>/stripe/webhook` as a Stripe webhook endpoint. Enable events on connected accounts and subscribe to `checkout.session.completed`. Copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
5. Restart the backend after setting environment variables.

Each tenant admin can then open **Billing**, add care services and rates, and select **Connect Stripe**. The merchant completes Stripe-hosted onboarding before the app enables Checkout. POAs pay the resident's outstanding balance through Checkout; successful payments are reconciled by the webhook. Admins retain manual payment reconciliation for payments taken outside the app.

## Key exposure

If a restricted key has been shared in chat or another public location, revoke it in Stripe and create a replacement before enabling payments. Do not save a revoked or exposed key in `.env` or any project file.
