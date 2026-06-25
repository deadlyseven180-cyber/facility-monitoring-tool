# Deploying the Facility Monitoring Tool to Render

This app is a standard Next.js 16 server (not static), so Render's **Web Service**
runtime is a great fit (unlike Netlify's serverless functions, which can't write
the `./.data` JSON files this tool uses).

## One-time setup

1. Put this project in a Git repo on GitHub/GitLab:
   ```bash
   git init
   git add -A
   git commit -m "Facility Monitoring Tool"
   git branch -M main
   git remote add origin https://github.com/<you>/facility-monitoring-tool.git
   git push -u origin main
   ```
2. In Render → **New → Blueprint**, choose that repo. Render reads `render.yaml`
   and creates a free Web Service automatically.
   - Or **New → Web Service** (no blueprint) with:
     - Build command: `npm install && npm run build`
     - Start command: `npm run start`
3. Wait for the first build (~2-4 min). Render gives you a public URL like
   `https://facility-monitoring-tool.onrender.com` — share that with anyone.

## Things to know

- **Airtable token:** internal complaints sync live from Airtable. Each viewer
  pastes a token in **Settings**, OR set `AIRTABLE_PAT` as a Render environment
  variable (uncomment it in `render.yaml`) so it works for everyone with no setup.
- **Persistence:** uploaded SpotHero history + notes are stored as JSON in
  `./.data`. On Render's **free** tier that folder resets on each restart/redeploy,
  and the service spins down after ~15 min idle (cold starts on next visit). The
  current `.data` is committed, so viewers still see existing data — but *new*
  uploads won't survive a restart. To make uploads permanent, switch `plan` to
  `starter` (paid) and uncomment the `disk:` block in `render.yaml`.
- **Custom Next.js:** none — this uses published `next@16.2.9`, so `npm install`
  on Render pulls the exact same version.
