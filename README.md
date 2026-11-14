# TwinTrack — private family twin tracker

A mobile-first, shared baby-care tracker built with **Vite + vanilla JavaScript + Supabase + Chart.js**. Deploys as a static site on GitHub Pages. The code is public if the GitHub repository is public; **the baby records are not stored in GitHub**. Trial version.

## Features in v1

- Separate baby profiles; both-baby or single-baby views
- Feed, diaper, sleep, medication and note logging
- Weight, length and head-circumference records
- Seven-day feed/diaper chart; CSV export (45-day activity window)
- Private family workspaces; individual email/password accounts
- Family-owner-generated, single-use, seven-day email-bound invitation links
- Supabase Realtime updates across signed-in devices
- Responsive layout for phones and desktops

**Not yet implemented:** true offline writes/PWA service worker, automated backups, reminders, edit history, vaccination scheduling, percentile curves, growth charts, medication safety checks, push notifications, multi-family switching, or automated clinical interpretation. This first version is an online-only responsive web app with a manifest, **not** a fully offline-capable PWA. Do not rely on it for medical alerts.

## Setup (roughly 20–30 minutes)

1. Create a free project at [Supabase](https://supabase.com/). In **SQL Editor**, paste and run `supabase/schema.sql` exactly once. Use a fresh project or review the SQL carefully before applying to an existing one.
2. Under **Authentication → Providers → Email**, enable email/password sign-in. **Keep email confirmation enabled** for real use; configure an SMTP provider if your project requires one for reliable invitations and confirmations. This app **does not send invitation emails**: it generates a link you privately share with the invited person. Email confirmation validates the email ownership.
3. Under **Authentication → URL Configuration**, set **Site URL** and **Redirect URLs** to your deployed GitHub Pages URL, for example `https://YOURNAME.github.io/little-days/`. Add `http://localhost:5173/**` for local testing. Do not use wildcard production redirects.
4. Copy your Supabase **Project URL** and **publishable/anon key** from Project Settings → API Keys. The key is designed to be exposed in the browser; **never use a service-role or secret key**.
5. For local testing, install Node.js 20+ and run:
   ```bash
   npm install
   cp .env.example .env.local
   # Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
   npm run dev
   ```
6. Create a GitHub repository (for example `little-days`) and push these files to `main`. Under **Settings → Pages**, set **Build and deployment → Source → GitHub Actions**.
7. Under GitHub repository **Settings → Secrets and variables → Actions → Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. These are public frontend configuration values, not secrets. The GitHub Actions workflow installs dependencies during deployment. For reproducible builds, commit a generated `package-lock.json` when available.
8. Push to `main` or manually run **Actions → Deploy to GitHub Pages**. Open the URL from your phone, create an account and confirm your email. Create a family and the two baby profiles.
9. Under **Family**, generate an invitation for a caregiver's email. Send the generated URL privately. They must sign up with **that exact email**, confirm it, and open the link while signed in. Invitation links are sensitive bearer tokens; never post them publicly.
10. On iPhone, open the site in Safari and choose **Share → Add to Home Screen**. On Android, use your browser's install/add-to-home-screen option. Native offline support is not included yet.

## Security model

- PostgreSQL Row Level Security is enabled on every application table. Families, babies, activities and growth data are readable only by members of the corresponding family. Only owners create babies or invitation links.
- Membership is created by a database trigger when a family is created, or by a server-side invite redemption function after checking both the token and authenticated email.
- Invitation tokens use 32 cryptographically random bytes; only SHA-256 hashes are stored in Supabase. The raw token appears only in the invitation URL fragment and is never sent to the server except when redeemed through the RPC. Invite links expire after seven days and can be redeemed once.
- No service-role key is included in frontend code. Do not disable RLS or expose database credentials.
- **Important:** A shared family member can edit or delete logged activities; this MVP does not have immutable audit history. Use only trusted caregivers. Membership removal, invite revocation, and audit logging are recommended before expanding beyond a small trusted family.
- Supabase email/password session is stored in browser storage by the Supabase client. Use device passcodes and sign out on shared devices.
- Medical data is sensitive. Review Supabase data residency, privacy requirements, backups, and any applicable regulations before using real records. Do not use this as the sole medical record.

## Database tables

| Table | Purpose |
|---|---|
| `families` | Family workspace and owner |
| `family_members` | Authorized users and roles |
| `babies` | Baby profiles |
| `activities` | Feeds, diapers, sleep, medication, notes; `details` JSONB |
| `growth` | Weight, length, head circumference |
| `invitations` | Single-use hashed invite tokens, bound to email |

The activities table has `(baby_id, started_at)` index, `created_by` attribution, and an immutable identity trigger. The UI only fetches 45 days / 2,000 activities for fast performance. CSV activity export therefore covers **only the fetched 45-day window**, not the full database history.

## Suggested next iteration

1. IndexedDB write queue + service worker with safe retry/deduplication and a clear offline badge.
2. Full historical export, encrypted backup strategy and family member management.
3. Editing activity entries, explicit audit events and user-friendly error recovery.
4. Growth charts using an appropriate clinically sourced standard, with gestational-age/corrected-age support.
5. Timers for feeding and sleep, plus optional reminders and a printable pediatrician report.

## Troubleshooting

- **Sign-up works but sign-in fails:** confirm the email, and inspect Supabase Auth logs.
- **No data appears:** confirm SQL ran, verify URL and publishable key, and inspect browser console/network requests.
- **Invite rejected:** confirm invited email matches the signed-in account, link has not expired/been used, and the URL fragment remains intact.
- **GitHub deployment fails:** confirm the GitHub Actions dependency-install step, configuration variables and Pages source.
- **Real-time updates delayed:** check Supabase Realtime status; refresh the page to reload records.

## Adding birth date and time to an existing installation

Before deploying the Add Birthday feature, run `supabase/migrations/20261115_add_birthday.sql` once in your project's Supabase SQL Editor. Do not rerun the full `schema.sql` against an existing database. Fresh installations use the updated `schema.sql` and do not need this migration.

In **Family → Baby profiles**, the family owner can select **Add birth date and time** for each baby, enter the local date and time recorded at birth, and confirm the details. Cancel leaves the record unchanged. After saving, all family members can read the details; the app and a database trigger prevent changing or clearing them. Name editing still works. Existing date-only records can be completed with a confirmed date and time once. Other devices see changes after reloading.

Times are stored as local clock values without timezone conversion, so all devices display the recorded birth date and time consistently. A Supabase integration with Codex is optional: the migration can be applied manually in SQL Editor. Apply the migration before merging/deploying the frontend change.
