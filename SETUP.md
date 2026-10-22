# Setup guide (for the repo owner)

eFootball Arena stores everything in **Supabase Postgres**, which is used only as a database: there's no Supabase Auth, and the browser never talks to Supabase. Every request goes through the Vercel functions in `api/`, which hold the `service_role` key.

Editors log in with their own username and password. One **owner** account manages the other admins. Every change is written to an append-only **audit log**, and the last 20 states are kept as **snapshots** the owner can roll back to.

---

## 1. Create the database

1. Create a project at <https://supabase.com> (the free tier is fine).
2. Open **SQL Editor → New query**, paste all of [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql), and click **Run**.
3. Open **Project Settings → API** and copy:
   - the **Project URL**, which becomes `SUPABASE_URL`;
   - the **`service_role`** key (*not* the `anon` key), which becomes `SUPABASE_SERVICE_ROLE_KEY`.

   Treat the service_role key like a root password. It bypasses Row Level Security, so it must only ever live in Vercel's environment variables.

## 2. Configure Vercel

In **Vercel → Project → Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Project URL from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key from step 1 |
| `SETUP_TOKEN` | A long random string. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

Delete the old variables. The app no longer uses them: `ADMIN_PASSWORD`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. You can also remove the Upstash integration.

Then **redeploy** (Deployments → ⋯ → Redeploy). The project needs Node 22, which `package.json` pins with `"engines": {"node": "22.x"}`.

## 3. Create the owner account

1. Open the site and click **Editor Login**.
2. Because no owner exists yet, the page shows **Create owner account**.
3. Enter the `SETUP_TOKEN`, a username (3–20 characters: `a-z`, `0-9`, `_`) and a password (at least 8 characters), then confirm the password.
4. You're now logged in as the owner.

From then on, `/api/setup` always returns **403**, and the form never appears again. You can delete `SETUP_TOKEN` from Vercel if you like.

## 4. Add other admins

As the owner, open **Admins → Add admin**. Enter a username and a temporary password, then share the password with that person privately. On their first login they must set a new password before they can do anything else.

On the same page you can:
- **Deactivate** or **Reactivate** an admin. Deactivating logs them out everywhere immediately.
- **Reset password** with a new temporary password. This also logs them out, and they must change it on their next login.
- **Restore** a snapshot to undo a bad change. The current state is saved as a snapshot first, so a restore can be undone too.

Every admin (not just the owner) can see the **Activity** page: who changed what, and when.

## 5. Migrating data from the old site

Do this **before** switching the old deployment over.

1. Save a backup of the current state from the old site. Either:
   - open the old site, press F12 → Console, type `exp()` and press Enter. This downloads `efootball-arena-backup.json`; or
   - run `curl https://YOUR-OLD-SITE/api/state`. The response is `{"data": {...}, "rev": ...}`. Save **only the `data` object** as `backup.json`.
2. Do steps 1–4 above.
3. Log in as the owner, open **Settings → Import backup**, and choose the file.

The import is saved to the database and appears in Activity as `import_backup`.

## 6. Recovering a lost owner password

Nobody can reset the owner's password from the app. Instead:

1. On any machine with this repo and Node installed, run:
   ```
   node scripts/hash-password.js
   ```
   Type the new password and press Enter. Running it with no argument keeps the password out of your shell history. The script prints a hash like `scrypt$16384$8$1$...`.
2. In the Supabase **SQL Editor**, run:
   ```sql
   update admins set password_hash = 'PASTE_HASH_HERE', must_change_password = true
     where role = 'owner';
   delete from sessions where admin_id = (select id from admins where role = 'owner');
   ```
3. Log in with the new password. You'll be asked to choose another one right away.

## 7. Local development

Use the Vercel CLI, because the API routes don't run under Live Server or other static servers.

```
npm install
cp .env.example .env.local      # fill in the three values (a separate dev Supabase project is a good idea)
npx vercel dev                  # http://localhost:3000
npm test                        # unit tests (no database needed)
```

The session cookie is `Secure`. Chrome and Firefox still accept Secure cookies on `http://localhost`. Other hostnames, such as a LAN IP, need HTTPS.

## Security notes

- **Passwords**
  - Hashed with scrypt (N=16384, r=8, p=1, a random 16-byte salt per password).
  - Never stored in the browser, never logged, and never written to the audit log.
- **Sessions**
  - A random 32-byte token in an `HttpOnly; Secure; SameSite=Strict` cookie that lasts 7 days.
  - The database stores only its SHA-256 hash.
  - Deactivating an admin or resetting their password deletes all their sessions.
- **CSRF**
  - Every POST, PATCH and DELETE must send the `X-Requested-With: arena` header, and an `Origin` that matches the site. Otherwise the request gets 403.
- **Login rate limiting**
  - More than 5 failed attempts for a username, or 20 from one IP, within 15 minutes → `429 Too many attempts`.
  - The error message is the same whether the username doesn't exist, the password is wrong, or the account is deactivated.
- **Database access**
  - Row Level Security is enabled on every table, with no policies. The public `anon` key can't read or write anything.
  - Access to the `save_state` function is revoked for `anon` and `authenticated`.
- **Audit log**
  - A trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` on `audit_log` for every role, including service_role.
  - One limit remains: the database owner (the `postgres` user in the SQL editor) could still drop that trigger. Nothing inside the database can stop that, so keep your Supabase dashboard login safe and use 2FA.
- **Concurrency**
  - Each save sends the revision it was based on. If another admin saved in between, the server returns 409, and the browser loads the latest version instead of overwriting it.
