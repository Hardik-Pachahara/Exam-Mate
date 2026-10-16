# Deploying to Vercel

## 1. Before you push to GitHub
- Your repo must contain `eng.traineddata` (in the project root, next to package.json). If your .gitignore has a line
  like `*.traineddata`, remove it. Vercel needs this file; it cannot download it at run time.
- Add these lines to .gitignore if they are not there yet:
      .env
      .env.*
      outputs/
      .vercel
- Run `npm install` once (it adds `@vercel/blob`), then check the app still works locally with `npm start`.

## 2. Create the project
1. vercel.com -> Add New -> Project -> import your GitHub repo. Leave the framework as "Other".
2. Do NOT deploy yet. Open Settings -> Environment Variables and add the variables below.
3. Open the Storage tab -> Create Database/Storage -> Blob -> choose **Private** -> connect it to this project
   (Production + Preview). Vercel adds BLOB_READ_WRITE_TOKEN for you.
4. Deploy.

## 3. Environment variables
| Name | Value |
|---|---|
| DATABASE_URL | Neon connection string. In Neon turn on "Connection pooling" and copy that string (host contains `-pooler`). Keep `sslmode=verify-full`. |
| GEMINI_API_KEYS | key1,key2,... |
| GEMINI_MODEL | the same as in your .env |
| EMAIL_VERIFICATION | off (or on, then also set RESEND_API_KEY and MAIL_FROM) |
| ADMIN_EMAIL | your email |
| TRUST_PROXY | 1 |
| APP_URL | https://YOUR-PROJECT.vercel.app (no slash at the end). Set it after the first deploy, then redeploy. |
| CRON_SECRET | any long random text (for the daily clean-up job) |
| DAILY_LIMIT, SPECIAL_DAILY_LIMIT, IP_DAILY_LIMIT, GLOBAL_DAILY_LIMIT, SIGNUP_IP_LIMIT, TIMEZONE | same as your .env |
| BLOB_READ_WRITE_TOKEN | added automatically by the Blob store |
Optional: MAX_PAGES (default 80 on Vercel), MAX_OCR_PAGES (default 15), KEEP_RESULTS_DAYS (default 3), OVERLOAD_TRIES, OCR_CLEANUP.

Do not set PORT. Do not add NODE_ENV (Vercel sets it).

## 4. After the first deploy
1. Copy the site address into APP_URL, then Deployments -> Redeploy.
2. Your admin account already exists, because Neon is the same database you use locally.
3. Run the checks in the test sheet, then these Vercel-only ones:
   - a PDF bigger than 5 MB uploads and highlights
   - the result opens in the viewer and the Download link works
   - a scanned PDF of 2 to 3 pages works (first run is slower)
   - Project -> Logs shows no red errors
4. Project -> Settings -> Cron Jobs should list /api/cleanup once a day.

## If something fails
Open Project -> Logs and look at the failing request.
- "Cannot find module ... pdf.worker.mjs" or tesseract files: the includeFiles list in vercel.json missed a file; tell me the exact path.
- 413 or "payload too large": the page is not using Blob. Check that BLOB_READ_WRITE_TOKEN exists and redeploy.
- Blank result viewer but Download works: the browser shows Blob files as downloads. Tell me and I will serve the result another way.
- Login works but you are logged out at once: APP_URL does not match the site address (cookie is marked Secure only for https).
