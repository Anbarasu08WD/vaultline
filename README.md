# Vaultline - Secure Digital Banking (Flask + PostgreSQL + Tailwind)

Real-time payments, account management and fraud detection. Built to deploy on Vercel.

## Deploy in 4 steps (no code changes needed)
1. **Push to GitHub.** Put this folder in a new repository and push it.
2. **Import in Vercel.** vercel.com/new, pick the repo, leave all build settings empty, click Deploy.
3. **Add the database + settings.** In the Vercel project:
   - Storage > Create > **Neon (Postgres)** and connect it to the project (this adds `DATABASE_URL` for you),
     or paste any PostgreSQL connection string into `DATABASE_URL`.
   - Settings > Environment Variables, add:

     | Name | Value |
     |------|-------|
     | `DATABASE_URL` | your PostgreSQL connection string (if not added by the integration) |
     | `JWT_SECRET` | any long random string |
     | `ADMIN_EMAIL` | the email that will become admin / fraud analyst |
     | `CRON_SECRET` | any long random string (enables daily interest and scheduled payments) |
     | `CURRENCY`, `DAILY_LIMIT`, `SAVINGS_APY` | optional (defaults: USD, 100000, 3.0) |
4. **Redeploy** (Deployments > ... > Redeploy), open the site, and register with your `ADMIN_EMAIL`.

Tables are created automatically on the first request. Check `https://YOUR-SITE.vercel.app/api/health` returns `{"status":"ok"}`.
Use a **new/empty database**. If you ran an earlier version of this project on the same database, drop its tables first.

## Features
**Everyday banking**
- Register / sign in (hashed passwords, 12-hour sessions, lock after 5 failed logins), friendly session-expired notice
- Multiple savings/current accounts with custom names, copy account number, freeze one account or **all at once**
- Send, deposit, withdraw. Each payment is one database transaction with row locks, so balances never double-spend
- **Review step** before every send, withdrawal or schedule, and **recipient name check** (e.g. "Priya S.") before money leaves
- **Saved recipients** and quick-pick chips, quick amount buttons, **daily send limit** with progress bar
- **Scheduled payments** (once, weekly, monthly) run by the daily cron job through the same fraud checks
- **Receipts** for every payment (print or copy the reference), searchable activity with filters, "load older" paging
- **CSV statements** per account and date range
- **Savings interest** paid daily and shown on the dashboard
- **Notifications** (money received, payment held, review outcomes, scheduled payments, security events)
- Get-started checklist for new customers, loading skeletons, mobile bottom navigation, accessible dialogs

**Security center**
- Change password, **sign out of all devices**, edit profile name, recent sign-in history, alert list, freeze controls

**Fraud detection and review (admin)**
- Risk score 0-100 on every payment: 40+ raises an alert, 70+ holds the payment (no money moves)
- Rules: large amount, 5x usual spending, burst of payments, first payment to a recipient, drains balance, repeated failed sign-ins
- Fraud review console: **release** or **reject** held payments, dismiss alerts, or confirm fraud (freezes the account)
- **Customers** tab (balances, locked users, unlock sign-in, freeze/unfreeze a customer) and **Audit log** tab

## Try the fraud flow
1. Register with your `ADMIN_EMAIL`. Open a second account (Accounts > Open another account).
2. Move money > Deposit 120,000 into the first account. (Tick "Save this recipient" when sending to others to build your list.)
3. Move money > Send 100,000 to your second account's number. It is held (risk 95), no money moves.
4. Fraud review tab > **Release payment** (money moves) or **Reject payment**.

## Run locally
```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export DATABASE_URL="postgresql://user:pass@localhost:5432/vaultline"
export JWT_SECRET="dev-secret" ADMIN_EMAIL="you@example.com"
python api/index.py          # open http://localhost:5000
```

## Project layout
```
api/index.py       Flask app (all /api/* routes)
public/            index.html, dashboard.html, css/, js/  (Stitch-based UI)
design/DESIGN.md   Stitch design system notes
schema.sql         Optional manual schema
vercel.json        Routes /api/* to Flask, security headers, daily cron
requirements.txt   Python dependencies
.env.example       Environment variables
```

## Notes
- "Real-time" = the dashboard refreshes every 10 seconds (serverless functions can't hold live connections).
- The daily job (interest + scheduled payments) runs at 00:00 UTC. Vercel Hobby allows one cron run per day, which is enough.
- Tailwind loads from its CDN for simplicity; compile it with the Tailwind CLI for production polish.
- Demo project, not a certified banking system. Don't use real financial data.
