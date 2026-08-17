# CFL Pick Pool — production-ready starter

This is a real multi-user web app starter built for Next.js + Supabase.

## What it includes

- Email/password authentication
- Player profiles
- Commissioner/admin role
- Weekly CFL slate management
- Winner picks for every game
- Confidence values 1–4, each used exactly once
- Exactly two point-spread picks
- Weekly deadlines and pick locking
- Automatic score calculation
- Season standings
- Weekly leaderboard
- Tiebreaker field
- Commissioner controls
- Optional CFL schedule feed integration
- Responsive mobile-first UI
- Supabase Row Level Security

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Copy `.env.example` to `.env.local`.
4. Fill in Supabase URL/key values.
5. Run:
   `npm install`
   `npm run dev`
6. Deploy to Vercel or another Next.js host.
7. Create your first user, then promote that user to commissioner using the SQL shown at the bottom of `supabase/schema.sql`.

## Production scoring

The app stores official results and scores picks server-side. A scheduled job should call the scoring endpoint after games finish. The included API route is designed for that purpose.

## CFL schedule feed

Set `CFL_API_URL` and `CFL_API_KEY` if you have a licensed/approved CFL data provider. The import route accepts a normalized JSON payload so the site is not tied to a questionable scraping source.

## Important

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in browser code. Keep it server-only.


## Automatic CFL schedule + secrecy

The app now includes `/api/cfl-sync`, a server-only importer intended to pull the official CFL data feed. Public references document a CFL API at `api.cfl.ca` with a schedule/games endpoint and API-key authentication; you will need an API key/access from the CFL API provider. citeturn1search0turn1search4

Run the sync from a scheduler (Vercel Cron, GitHub Actions, or another cron service) once or twice daily. The sync updates games and kickoff times without exposing the API key to users.

**Pick secrecy:** Row Level Security now allows a pick to be read by:
1. its owner,
2. the commissioner, or
3. any authenticated player only after that specific game's kickoff.

That means the Thursday game can reveal Thursday at kickoff while Saturday games remain completely hidden until their own kickoff. This is enforced in the database, not merely hidden with JavaScript.

### Point spreads

The CFL schedule itself does not supply betting spreads. Keep spreads as a separate commissioner/admin field or connect an odds provider. The two spread picks are stored independently from the winner/confidence picks.

### Recommended production flow

- 6–7 days before the week: sync CFL schedule.
- Commissioner reviews games and enters/approves spreads.
- Players submit picks before the weekly deadline.
- At each kickoff, that game's picks become visible.
- After final scores arrive, the scoring job calculates winner confidence + spread bonus.
- Standings update automatically.


## Frozen point spreads

The spread is a **snapshot**, not a live betting line.

- The imported line is stored with `spread_source="theScore"`.
- The commissioner locks the week's spreads before the pool opens.
- A database trigger prevents later changes to a locked spread.
- Automatic schedule/result sync can continue updating kickoff/status/scores, but **cannot change a locked spread**.
- Every player therefore competes against the exact same frozen line.
- The UI displays "Frozen line" and a lock icon.

theScore currently offers CFL point spreads and publishes CFL scores/schedules. citeturn0search8turn0search2

For production use, automated extraction from the consumer website should only be used if its terms/technical access permit it. If theScore provides an authorized data/API feed for your account, use that rather than scraping pages.
