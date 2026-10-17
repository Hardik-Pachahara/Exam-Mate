# Exam Mate

Upload a PDF chapter and get it back marked up for revision. Exam Mate reads the pages, asks Google Gemini to pick the important passages (definitions, key facts, formulas, names, dates, examples), and highlights them in the PDF in colour-coded categories. Scanned pages are read with OCR. You can choose which pages to process and optionally focus on one topic.

## Features

- Highlights key points in a PDF, colour-coded by type, with a notes panel beside the result
- Works on normal PDFs and scanned pages (OCR)
- Choose pages, and optionally type a topic to focus on
- Several Gemini API keys, tried in turn when one runs out of quota
- Accounts: sign up, log in, admin approval, per-day usage limits (normal, special, admin)
- Admin dashboard to approve users, set limits and delete accounts

## Requirements

- [Node.js](https://nodejs.org) 20 or newer
- A free [Neon](https://neon.tech) Postgres database
- At least one [Gemini API key](https://aistudio.google.com/apikey)
- Optional: a [Resend](https://resend.com) account to email verification links

## Quick start

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
npm install
```

Create a file named `.env` in the project folder (see [the `.env` file](#the-env-file) below), then start the app:

```bash
npm start
```

Open <http://localhost:3000>.

### Create your admin account

1. Open the site and sign up with your email.
2. If you are not using email sending, the verification link is printed in the terminal. Open it. (Or set `EMAIL_VERIFICATION=off`, see below.)
3. Stop the server (Ctrl+C) and run:

```bash
node make-admin.js you@example.com
```

4. Start the server again and log in. Admin accounts have unlimited highlights and see the admin dashboard, where you approve new users.

New accounts stay locked until the admin approves them.

### Check your Gemini keys

```bash
node check-key.js
```

Tests every key in `GEMINI_API_KEYS` and tells you which work.

## The `.env` file

The `.env` file holds your secrets and settings. **It is not included in this repository and must never be committed**, because it contains passwords and API keys. Create it yourself in the project root (next to `package.json`).

Format: one `NAME=value` per line. Lines starting with `#` are comments. Do not put spaces around `=`. Quotes are optional. Variables you set in the terminal or in your hosting dashboard take priority over the file.

### Minimal example

```env
GEMINI_API_KEYS=AIza...key1,AIza...key2
DATABASE_URL=postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require
APP_URL=http://localhost:3000
ADMIN_EMAIL=you@example.com
```

### Required

| Variable | What it is | How to get it |
|---|---|---|
| `GEMINI_API_KEYS` | One or more Gemini API keys separated by commas, no spaces. They are tried in order; when one runs out of quota, the next is used. | Google AI Studio, "Create API key". `GEMINI_API_KEY` (a single key) also works and is combined with this list. |
| `DATABASE_URL` | Connection string of your Postgres database. Tables are created automatically on first start. | Neon dashboard, your project, "Connect", copy the connection string. On Vercel use the **pooled** one (host contains `-pooler`). |

### Strongly recommended

| Variable | Default | What it does |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | Public address of the site, no trailing slash. Used in verification-email links. If it starts with `https`, cookies are marked Secure. Set it to your real address when deployed, e.g. `https://yourapp.vercel.app`. |
| `ADMIN_EMAIL` | none | The admin's email address. When this email verifies, the account is approved automatically. |

### Email (Resend)

| Variable | Default | What it does |
|---|---|---|
| `RESEND_API_KEY` | none | Resend API key. If empty, **no email is sent** and the verification link is printed in the terminal instead, which is fine for local testing. |
| `MAIL_FROM` | `Exam Mate <onboarding@resend.dev>` | The sender. Resend's default sender can only email your own Resend account address. To email other people you must verify a domain in Resend and use an address on it, e.g. `Exam Mate <noreply@yourdomain.com>`. |
| `EMAIL_VERIFICATION` | `on` | Set to `off` to skip the email step: a new account is verified immediately and only waits for admin approval. Useful when you have no domain. *(Only present if your copy includes the verification switch.)* |

### Gemini model

| Variable | Default | What it does |
|---|---|---|
| `GEMINI_MODEL` | `gemini-3.5-flash` | The model to use. |
| `GEMINI_FALLBACK_MODELS` | none | Comma-separated models to try if the first one fails, e.g. `gemini-2.5-flash,gemini-2.5-flash-lite`. |
| `GEMINI_THINKING` | `low` | Thinking level for Gemini 3 models. |
| `GEMINI_BATCH_CHARS` | `24000` | Text sent per Gemini request. Smaller means more requests. |
| `OVERLOAD_TRIES` | `2` | Attempts when Google replies "busy" (503) before pausing that model for 60 seconds. |
| `OFFLINE_FALLBACK` | off | Set to `on` to use a simple built-in highlighter when Gemini is unavailable. It ignores the topic box. |

### Usage limits (per day)

| Variable | Default | What it does |
|---|---|---|
| `DAILY_LIMIT` | `5` | Highlights per normal account per day. Can be changed later in the admin dashboard. |
| `SPECIAL_DAILY_LIMIT` | `25` | Highlights per special account per day. |
| `GLOBAL_DAILY_LIMIT` | `100` | Total highlights per day across all accounts, to protect your Gemini quota. |
| `IP_DAILY_LIMIT` | `10` | Highlights per IP address per day. |
| `SIGNUP_IP_LIMIT` | `2` | New accounts per IP address per 24 hours. |
| `TIMEZONE` | `Asia/Kolkata` | Time zone that decides when "a day" starts for the limits. Use an IANA name such as `Europe/London`. |

Admin accounts have no limit. A failed run does not use up an attempt.

### Security / hosting

| Variable | Default | What it does |
|---|---|---|
| `TRUST_PROXY` | off | Set to `1` only when the app runs behind a proxy that sets `x-forwarded-for` (Vercel does). It makes IP limits use the visitor's real address. Never set it when the app is directly on the internet. |

### Scanned pages and large PDFs

| Variable | Default | What it does |
|---|---|---|
| `OCR_CLEANUP` | on | Set to `off` to skip the lighting clean-up applied to scans before OCR. |
| `MAX_PAGES` | none locally, `80` on Vercel | Most pages processed in one run. `0` means no limit. |
| `MAX_OCR_PAGES` | none locally, `15` on Vercel | Most scanned pages OCR'd in one run. |

### Vercel only

| Variable | What it does |
|---|---|
| `BLOB_STORE_ID` | Turns on Vercel Blob storage for uploads and results. Created automatically when you create a **private** Blob store and connect it to the project (leave the prefix blank). Without it, files are handled on local disk. |
| `BLOB_WEBHOOK_PUBLIC_KEY` | Also created automatically with the store. Not used by this app; leave it. |
| `BLOB_READ_WRITE_TOKEN` | Optional. Only needed if you tick "Add a read-write token" when creating the store. Not required. |
| `CRON_SECRET` | Secret that protects the daily cleanup job. Any long random string. |
| `KEEP_RESULTS_DAYS` | Days to keep result PDFs in Blob. Default `3`. |

Set `CRON_SECRET` and the other values in the Vercel project's **Settings, Environment Variables**, not in a file. The `BLOB_` variables are added for you when the store is connected.

### Keep it secret

- Add `.env` to `.gitignore` (this repository already does). Check with `git status` before every commit.
- If a key or password is ever committed or shared, **revoke it and make a new one**, since deleting the commit does not remove it from history.
- Gemini keys belong to your own Google projects; use only keys you are allowed to use, within [Google's terms](https://ai.google.dev/gemini-api/terms).

## Using the app

1. Log in, then choose a PDF (or drop it on the box).
2. Tick the pages to highlight. Pages you leave out are never read, OCR'd or sent to Gemini.
3. Optionally type a topic so only passages about it are marked.
4. Press **Highlight** (or press Enter). Long chapters can take a few minutes.
5. View the result, read the notes panel, and download the PDF.

## Project layout

```
server.js            starts the app on your computer
api/index.js         entry point used on Vercel
make-admin.js        makes an account an admin
check-key.js         tests your Gemini keys
public/              the web pages (index, app.js, style.css, auth, admin)
src/
  pipeline.js        runs the steps below in order
  textLayer.js       reads text from normal PDFs
  pdfToImages.js     renders scanned pages to images
  ocrTool.js         OCR for scanned pages
  analyzer.js        asks Gemini for passages, rotates keys
  matcher.js         finds each passage's position on the page
  highlighter.js     draws the highlights into the PDF
  authRoutes.js      sign up, login, admin endpoints
  usage.js, limits.js  daily limits
  db.js              Postgres connection and tables
  mailer.js          sends verification email
```

## Deploying to Vercel

1. Push the project to GitHub (without `.env`).
2. Import the repository in Vercel.
3. Add your environment variables under **Settings, Environment Variables**. Use the pooled Neon connection string and set `APP_URL` to your Vercel address.
4. For PDFs larger than about 4 MB, create a private Blob store (Storage tab) and connect it to the project; Vercel functions cannot accept larger uploads directly. Add `CRON_SECRET` so the daily cleanup job can run.
5. Deploy, sign up on the live site, and make yourself admin. `make-admin.js` needs `DATABASE_URL`, so run it from your computer with the same value in `.env`.

## Troubleshooting

| Problem | Likely cause |
|---|---|
| "Set GEMINI_API_KEYS ... first" | `.env` is missing, in the wrong folder, or the variable name is misspelled. |
| "Could not connect to the database" | `DATABASE_URL` is wrong or missing `?sslmode=require`. Copy it again from Neon. |
| No verification email arrives | `RESEND_API_KEY` is empty (check the terminal for the link), or `MAIL_FROM` uses a domain you have not verified in Resend. |
| "Daily limit reached" from Gemini | Your keys' quota is used up; it resets daily. Limits apply per Google project, not per key. |
| Highlights look misplaced on a scan | Use a clearer or straighter scan; keep `OCR_CLEANUP` on. |

## Contributing

Issues and pull requests are welcome. Please do not include `.env` files, API keys or PDFs in them.

## License

Add a license of your choice (for example MIT) as a `LICENSE` file.