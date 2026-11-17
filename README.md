# Build a CRM with HyphaBase

The example app from the **Build a CRM with HyphaBase** series. One small CRM, built one feature at a time on [HyphaBase](https://hyphabase.com), the Backend-as-a-Service for developers building multi-location business software. The app is **Brightside CRM**: the customer list for Brightside Cleaning, a home cleaning company with a few hundred regulars and locations in Portland and Salem. Each episode ends at a tagged commit you can check out and run.

> **The sandbox is free and open by invitation.** Join the early-access list at [hyphabase.com](https://hyphabase.com) and we'll send you an invite code. Already have one? [Create your account](https://console.hyphabase.com/register) and run every episode against your own backend.

## Episodes

| Episode | What gets built | Guide | Article |
| --- | --- | --- | --- |
| 1 | The backend: an app and its first location, with a dedicated database | [episode-01-backend](episodes/episode-01-backend.md) | [Database per tenant vs. shared database](https://hyphabase.com/blog/database-per-tenant-vs-shared-database) |
| 2 | A Customers collection, and the first customer created and read through the API | [episode-02-customers](episodes/episode-02-customers.md) | [A CRUD API without the boilerplate](https://hyphabase.com/blog/crud-api-without-boilerplate) |
| 3 | Sign-in: a first user, and a server that refuses anyone who is not signed in | [episode-03-authentication](episodes/episode-03-authentication.md) | [Authentication vs. authorization](https://hyphabase.com/blog/authentication-vs-authorization-saas) |
| 4 | Roles: an Owner and a Staff role, and a server that checks what each person may do | [episode-04-permissions](episodes/episode-04-permissions.md) | coming soon |
| 5 | The SDK and a real frontend: sign in, see the customers and add one, in a browser | [episode-05-sdk-frontend](episodes/episode-05-sdk-frontend.md) | coming soon |
| 6 | Editing and deleting customers | planned | |

To see the code as it stood at the end of an episode, check out its tag: `episode-02-customers`, `episode-03-authentication`, `episode-04-permissions` or `episode-05-sdk-frontend`. Episode 1 is all console, so it has no tag.

## Run it

You need Node 20.6 or newer and a HyphaBase app with a secret key ([episode 1](episodes/episode-01-backend.md)). Episodes 2 to 4 have nothing to install: the scripts use Node's built-in `fetch`.

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

From episode 4 signing in is not enough: a person needs a role. The key needs the `roles.view`, `roles.create`, `roles.assign`, `users.view` and `data.records.delete` scopes (see [the guide](episodes/episode-04-permissions.md)):

```bash
npm run user:add -- --name "Marcus Bell" --email marcus@brightsideclean.example
npm run roles:setup       # define the Owner and Staff roles
npm run role:give -- --email sarah@brightsideclean.example --role owner
npm run role:give -- --email marcus@brightsideclean.example --role staff

# in the second terminal, signed in as Marcus
npm run crm:me            # who you are and what you may do
npm run crm:customers     # the customer list
npm run crm:delete -- --email dana@example.com    # 403 Your role does not allow this.
```

From episode 5 the CRM is a web app, in `web/`. `.env` needs `HYPHABASE_PUBLISHABLE_KEY`, the publishable half of the same key (see [the guide](episodes/episode-05-sdk-frontend.md)):

```bash
npm --prefix web install  # once
npm run web               # http://localhost:3010
```

Sign in as Sarah to see the customers and add one. Sign in as Marcus and the list is there, the **Add customer** button is not.

The web app uses the HyphaBase SDK, the [`hyphabase`](https://www.npmjs.com/package/hyphabase) package on npm.

## What this is, and isn't, so far

After episode 5 the CRM has a data foundation (a real table with typed fields, a unique email and a default status), a sign-in, roles, and screens: a Next.js app whose pages hold no key and no token, and whose server refuses every request that does not come from a signed-in user whose role allows it. A person can see the customers and add one. Editing and deleting from the screen come next.

## Keep your secret key secret

The key in `.env` can read and write your data. It belongs on a server or your own machine. `.env` is gitignored; keep it that way, and never put an `sk_` key in browser code. The same goes for `.session`, which holds your sign-in token.

In the web app only `web/lib/server.ts` reads the secret key. It is marked server-only, so the build fails if a page imports it, and `npm run smoke:web` checks that the key is in no file a browser can download.

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
| `403 Your role does not allow this.` | Episode 4 on: you are signed in, but your role lacks the permission. `npm run crm:me` shows what you have; `npm run role:give` gives a user a role. |
| `No user with the email ...` | `role:give` could not find that user. Create them with `npm run user:add` first. |
| `Active employees limit reached (5 of 5 used).` | Your plan's user limit. `npm run smoke` creates three test users while it runs and removes them afterwards only if the key has the `users.delete` scope. |
| `Could not reach the CRM server` | `npm run serve` is not running, or `CRM_URL` / `PORT` do not match. |
| `Set HYPHABASE_PUBLISHABLE_KEY to a publishable key` (in the `npm run web` log) | Episode 5 on: add the key's publishable half to `.env`, then restart `npm run web`. |
| The web app says `The CRM could not reach its backend.` | The reason is in the terminal running `npm run web`: usually a wrong `HYPHABASE_API_URL` or a missing scope on the key. |
| `Could not reach the API` | `HYPHABASE_API_URL` is wrong, or the API is down. |

## Tests

```bash
npm test             # unit tests, no network
npm run smoke        # episodes 2 to 4 against the environment in .env
npm run web:test     # the web app's unit tests, no network
npm run smoke:web    # the built web app against the environment in .env
```

The smoke test creates three test users and a test customer and removes them when it is done. Removing the users needs the `users.delete` scope on the key, which the CRM itself does not use; without it they stay, and they count towards your plan's user limit.

## More

- [Documentation](https://docs.hyphabase.com) and the [API reference](https://api.hyphabase.com/docs/api)
- The SDK: [`hyphabase`](https://www.npmjs.com/package/hyphabase) on npm
- New episodes are announced on [X](https://x.com/hyphabase) and [LinkedIn](https://www.linkedin.com/company/hyphabase)

## License

MIT
