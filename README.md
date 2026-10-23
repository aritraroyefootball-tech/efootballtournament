# eFootball Arena

A single-file tournament manager (`index.html`, vanilla JS, no build step) deployed on Vercel. It covers group stage fixtures, standings with tie-breaks, a knockout bracket, a champion reveal, and a Hall of Fame.

Anyone can view the dashboard, matches, standings and knockout bracket without logging in.

## Admin & security

- Editors log in with **their own username and password**. Sessions are server-side and use an HttpOnly cookie. No shared password exists, and nothing secret is stored in the browser.
- One **owner** creates, deactivates, reactivates and resets the passwords of the other admins on the **Admins** page.
- Every change is recorded in an **append-only audit log**, which admins can view on the **Activity** page.
- The last 20 states are kept as **snapshots**. The owner can restore any of them.
- Data lives in **Supabase Postgres**, and all reads and writes go through the serverless functions in `api/`. To get **live updates**, the browser listens on Supabase Realtime with the public anon key. That key can only read the tournament data, and it can't write anything. If Realtime isn't set up, pages poll every 5 seconds instead.

See **[SETUP.md](SETUP.md)** for deployment, first-time owner setup, data migration, password recovery and local development.

```
npm install
npm test
```
