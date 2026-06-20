# Setting up the AI submission review

This adds one serverless function (`/api/review-submission.js`) that runs on
Vercel. It sits between the "Start a project" form and your inbox: every
submission gets reviewed by Gemini (summary, missing info, plan fit, draft
reply) before the email reaches hello@webstrakt.com.

## What changed

- `index.html` — the form now POSTs to `/api/review-submission` instead of
  straight to FormSubmit.
- `api/review-submission.js` — new serverless function that does the AI
  review, then forwards the result to FormSubmit itself.
- `package.json` — minimal, just tells Vercel this is a Node 18+ project
  (no dependencies — it uses the built-in `fetch`).

## One-time setup

1. **Push these files to your GitHub repo** (replace your current `index.html`
   with the updated one, and add the `api/` folder and `package.json` at the
   repo root, next to `index.html`).

2. **Import the repo into Vercel** (if you haven't already):
   - vercel.com → Add New → Project → select this GitHub repo.
   - Framework preset: "Other" (it's a static file + one API route, no build
     step needed). Leave build/output settings blank.
   - Deploy.

3. **Get a Gemini API key and add it as an environment variable**:
   - Get a key at aistudio.google.com/apikey (sign in with a Google account,
     click "Create API key").
   - In the Vercel project → Settings → Environment Variables.
   - Add `GEMINI_API_KEY` with that key.
   - Apply it to Production (and Preview, if you want AI review on preview
     deploys too).
   - Redeploy after adding it (env vars only apply to new deployments).

4. **Test it**: submit the form on the live site. You should get one email
   at hello@webstrakt.com containing the original details plus an "AI review"
   section (summary, missing info, recommended fit, draft reply).

## Notes

- If the Gemini call fails for any reason (no key yet, rate limit, etc.), the
  function still forwards the raw enquiry — you just won't see the AI review
  section for that one. Nothing is ever silently dropped.
- This reuses your existing FormSubmit destination (hello@webstrakt.com), so
  there's no new email service to sign up for.
- The function uses `gemini-2.5-flash`, a fast and inexpensive model — a
  typical enquiry review should cost a small fraction of a cent. You can swap
  the model string at the top of `review-submission.js` if you'd rather use a
  different Gemini model.
