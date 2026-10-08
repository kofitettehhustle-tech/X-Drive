# X Drive Backend Setup

The storefront reads its service list from `GET /api/storefront/catalog`. The Node server fetches the Morethanpanel catalog on startup and refreshes it every seven days. The provider API key stays on the server.

## Configure

1. Use Node.js 22.13 or newer and install dependencies with `npm install`.
2. Copy `.env.example` to `.env` for local development.
3. Set `MORETHANPANEL_API_KEY` to the key from the Morethanpanel account.
4. Set `XDRIVE_MARKUP_PERCENT` to X Drive's approved customer markup. It is intentionally required; the backend will not guess a selling price.
5. Start the site with `npm run dev`, or use `npm start` for a normal Node process.
6. Run the database tests with `npm test`.

## Local credentials

Paste credentials only into the ignored local `.env` file, never into frontend JavaScript or chat. `MORETHANPANEL_API_KEY` and `XDRIVE_MARKUP_PERCENT` are read by the current server. The `.env.example` file documents variable names but must not contain real secrets.

`BASEROW_API_URL`, `BASEROW_DATABASE_TOKEN`, and `BASEROW_TABLE_ID` are reserved for the planned Baserow adapter. The server does not read these values yet; catalog persistence currently uses SQLite. Before wiring Baserow, confirm the target table and its field names. For self-hosted Baserow, set `BASEROW_API_URL` to that instance's API base URL.

For deployment, set both values as server-side secrets/environment variables in the hosting provider's dashboard. Do not use browser-prefixed variables or place either secret in frontend JavaScript.

## Catalog behavior

The backend requests the provider's `services` action, keeps services that can be mapped to a supported social platform, and applies the configured markup to the provider's per-1K rate. A local SQLite database at `data/xdrive.sqlite` stores the most recent complete catalog snapshot so it survives server restarts. Set `XDRIVE_DATABASE_PATH` to change the file location. The database includes provider service IDs for server-side fulfillment; the public response contains X Drive IDs and customer-facing prices only.

If the key or markup is missing and no prior snapshot exists, the endpoint returns `503` and the storefront remains in preview mode. If a later refresh fails, the last successful database snapshot remains available across restarts.

The provider's documented service list does not contain a delivery estimate. The backend leaves `deliveryEstimate` empty rather than inventing a timing claim.