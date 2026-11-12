# Build a CRM with HyphaBase

The example app from the **Build a CRM with HyphaBase** series. One small CRM, built one feature at a time on a [HyphaBase](https://hyphabase.com) backend. The app is **Brightside CRM**: the customer list for Brightside Cleaning, a home cleaning company with a few hundred regulars and locations in Portland and Salem. Each episode ends at a tagged commit you can check out and run.

> **Status: pre-release.** The free sandbox is not open for signups yet, so you can read the code but not run it against your own backend today. [Get early access](https://hyphabase.com) and we'll email you when it opens.

## Episodes

| Episode | What gets built | Guide |
| --- | --- | --- |
| 1 | The backend: an app and its first location, with a dedicated database | [episode-01-backend](episodes/episode-01-backend.md) |
| 2 | A Customers collection, and the first customer created and read through the API | [episode-02-customers](episodes/episode-02-customers.md) |
| 3 | Sign-in: a first user, and a server that refuses anyone who is not signed in | [episode-03-authentication](episodes/episode-03-authentication.md) |
| 4 | Roles and permissions | planned |
| 5 | The SDK and a real frontend | planned |

## Run it

You need Node 20.6 or newer and a HyphaBase app with a secret key ([episode 1](episodes/episode-01-backend.md)). There is nothing to install: the scripts use Node's built-in `fetch`.

```bash
git clone https://github.com/HyphaBase/hyphabase-series-crm.git
cd hyphabase-series-crm
cp .env.example .env      # then fill in your API URL and secret key

npm run setup             # define the Customers collection
npm run customer:add      # create a customer and read it back
npm run customer:list     # list every customer
```

Expected output:

```text
$ npm run setup
Created the Customers collection:
  name     string, required
  email    string, required, unique
  phone    string
  status   enum, required, default lead

$ npm run customer:add
Created customer f294a1f4-3625-49e3-a491-2e9ecc71769e
Read it back from the API:
{
  id: 'f294a1f4-3625-49e3-a491-2e9ecc71769e',
  name: 'Dana Whitfield',
  email: 'dana@example.com',
  phone: '555-0142',
  status: 'lead',
  ...
}
```

Add your own with `npm run customer:add -- --name "Liam Ortiz" --email liam.ortiz@example.com --status active`.

From episode 3 the customers sit behind a sign-in. The key needs the `users.create` scope and access to your location, and `.env` needs `HYPHABASE_LOCATION_ID` (see [the guide](episodes/episode-03-authentication.md)):

```bash
npm run user:add          # create Sarah, the first user (asks for a password)
npm run serve             # start the CRM server; leave it running

# in a second terminal
npm run crm:customers     # 401 Sign in first.
npm run crm:signin        # sign in as Sarah
npm run crm:customers     # the customer list
npm run crm:signout
```

## What this is, and isn't, so far

After episode 3 the CRM has a data foundation (a real table with typed fields, a unique email and a default status) and a sign-in: users are stored by HyphaBase, and a small server refuses every request that does not come from a signed-in user. It has no permissions yet, so every signed-in user can see everything, and no screens. Those come in the next episodes.

## Keep your secret key secret

The key in `.env` can read and write your data. It belongs on a server or your own machine. `.env` is gitignored; keep it that way, and never put an `sk_` key in browser code. The same goes for `.session`, which holds your sign-in token.

## Troubleshooting

| You see | What it means |
| --- | --- |
| `Missing HYPHABASE_...` | `.env` is missing or incomplete. Copy `.env.example` and fill it in. |
| `Invalid, expired, or revoked API key.` | The key in `.env` is wrong or was revoked. Create a new one in the console. |
| `This API key does not have the '...' scope` | Edit the key in the console and add the scope it names. |
| `record: A record with the same unique value already exists.` | A customer with that email already exists. Pass a different `--email`. |
| `slug: A collection with this slug already exists (or is awaiting purge).` | The collection was deleted in the last 30 days. Restore it in the console instead of recreating it. |
| `Missing HYPHABASE_LOCATION_ID` | Episode 3 on: add your location's id to `.env`. |
| `This API key does not have access to the requested location.` | In the console, open the key's **Access** settings and grant it the location. |
| `email: The email has already been taken.` | That user already exists. Sign in, or pass a different `--email` to `user:add`. |
| `Could not reach the CRM server` | `npm run serve` is not running, or `CRM_URL` / `PORT` do not match. |
| `Could not reach the API` | `HYPHABASE_API_URL` is wrong, or the API is down. |

## Tests

```bash
npm test         # unit tests, no network
npm run smoke    # the whole walkthrough against the environment in .env
```

## License

MIT
