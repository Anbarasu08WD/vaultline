"""
Vaultline - secure digital banking demo.
Flask + PostgreSQL, built to run as a Vercel serverless function.

Every request opens a short-lived database connection (serverless friendly),
and every money movement runs inside one PostgreSQL transaction with row locks
so balances can never be double-spent.
"""
import os
import re
import csv
import io
import hmac
import secrets
import logging
import datetime as dt
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import wraps

import jwt
import psycopg2
import psycopg2.extras
from flask import Flask, request, jsonify, g, send_from_directory, Response
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
log = logging.getLogger("vaultline")

DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
IS_VERCEL = bool(os.environ.get("VERCEL"))
JWT_SECRET = os.environ.get("JWT_SECRET", "")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "").strip().lower()
CURRENCY = os.environ.get("CURRENCY", "USD")
CRON_SECRET = os.environ.get("CRON_SECRET", "")


def _decimal_env(name, default):
    try:
        return Decimal(os.environ.get(name, default))
    except InvalidOperation:
        return Decimal(default)


DAILY_LIMIT = _decimal_env("DAILY_LIMIT", "100000")  # max money out per customer per UTC day
SAVINGS_APY = _decimal_env("SAVINGS_APY", "3.0")     # yearly interest on savings accounts, in percent

BLOCK_AT = 70  # risk score at which a payment is held and never executed
ALERT_AT = 40  # risk score at which a completed payment raises an alert
MAX_ACCOUNTS = 5

SCHEMA = """
SELECT pg_advisory_xact_lock(727001);

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    full_name     TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    failed_logins INT  NOT NULL DEFAULT 0,
    token_version INT  NOT NULL DEFAULT 0,
    locked_until  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
    id             SERIAL PRIMARY KEY,
    user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_number TEXT NOT NULL UNIQUE,
    nickname       TEXT,
    type           TEXT NOT NULL DEFAULT 'savings' CHECK (type IN ('savings', 'current')),
    balance        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
    last_interest_on DATE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

CREATE TABLE IF NOT EXISTS transactions (
    id           SERIAL PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('deposit', 'withdraw', 'transfer', 'interest')),
    from_account INT REFERENCES accounts(id),
    to_account   INT REFERENCES accounts(id),
    amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    note         TEXT,
    status       TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'blocked', 'rejected')),
    risk_score   INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_from ON transactions(from_account, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_to   ON transactions(to_account, created_at DESC);

CREATE TABLE IF NOT EXISTS fraud_alerts (
    id             SERIAL PRIMARY KEY,
    transaction_id INT REFERENCES transactions(id) ON DELETE CASCADE,
    user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason         TEXT NOT NULL,
    risk_score     INT NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'released', 'rejected', 'dismissed', 'confirmed')),
    reviewed_by    INT REFERENCES users(id),
    reviewed_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON fraud_alerts(status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
    id         SERIAL PRIMARY KEY,
    user_id    INT REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT NOT NULL,
    detail     TEXT,
    ip         TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payees (
    id             SERIAL PRIMARY KEY,
    user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    account_number TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, account_number)
);

CREATE TABLE IF NOT EXISTS notifications (
    id         SERIAL PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'info',
    title      TEXT NOT NULL,
    body       TEXT,
    is_read    BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, id DESC);

CREATE TABLE IF NOT EXISTS scheduled_payments (
    id                SERIAL PRIMARY KEY,
    user_id           INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_account      INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_account_number TEXT NOT NULL,
    amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    note              TEXT,
    frequency         TEXT NOT NULL CHECK (frequency IN ('once', 'weekly', 'monthly')),
    next_run          DATE NOT NULL,
    active            BOOLEAN NOT NULL DEFAULT true,
    last_status       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_payments(active, next_run);
"""


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message, self.status = message, status


@app.errorhandler(ApiError)
def handle_api_error(e):
    return jsonify({"error": e.message}), e.status


@app.errorhandler(404)
def handle_404(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found"}), 404
    return e


@app.errorhandler(Exception)
def handle_unexpected(e):
    if hasattr(e, "code") and isinstance(e.code, int):  # werkzeug HTTP errors
        return e
    log.exception("Unhandled error")
    return jsonify({"error": "Something went wrong on our side. Try again."}), 500


def db():
    if not DATABASE_URL:
        raise ApiError("Database is not configured. Set the DATABASE_URL environment variable.", 500)
    if "conn" not in g:
        g.conn = psycopg2.connect(
            DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor, connect_timeout=10
        )
    return g.conn


@app.teardown_appcontext
def close_db(exc):
    conn = g.pop("conn", None)
    if conn is not None:
        try:
            if exc:
                conn.rollback()
        finally:
            conn.close()


_schema_ready = False


@app.before_request
def ensure_schema():
    global _schema_ready
    if not request.path.startswith("/api/"):
        return
    if not JWT_SECRET and (IS_VERCEL or not app.debug):
        raise ApiError("Server is not configured. Set the JWT_SECRET environment variable.", 500)
    if _schema_ready:
        return
    conn = db()
    with conn.cursor() as c:
        c.execute(SCHEMA)
    conn.commit()
    _schema_ready = True


def ser(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (dt.datetime, dt.date)):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: ser(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [ser(x) for x in v]
    return v


def ok(data, status=200):
    return jsonify(ser(data)), status


def body():
    return request.get_json(silent=True) or {}


def client_ip():
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or request.remote_addr or "")


def audit(c, user_id, action, detail=""):
    c.execute(
        "INSERT INTO audit_logs(user_id, action, detail, ip) VALUES (%s,%s,%s,%s)",
        (user_id, action, detail[:500], client_ip()),
    )


def notify(c, user_id, title, body="", kind="info"):
    c.execute(
        "INSERT INTO notifications(user_id, kind, title, body) VALUES (%s,%s,%s,%s)",
        (user_id, kind, title[:120], (body or "")[:300]),
    )


def mask_name(full_name):
    parts = str(full_name).split()
    if not parts:
        return "Customer"
    return parts[0] + (f" {parts[-1][0].upper()}." if len(parts) > 1 else "")


@app.after_request
def no_store(resp):
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


def parse_amount(value, maximum=Decimal("1000000")):
    try:
        amount = Decimal(str(value).strip()).quantize(Decimal("0.01"), ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        raise ApiError("Enter a valid amount, for example 250.00")
    if amount <= 0:
        raise ApiError("Amount must be greater than zero")
    if amount > maximum:
        raise ApiError(f"Amount is above the limit of {maximum:,.0f} per payment")
    return amount


def auth(role=None):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            header = request.headers.get("Authorization", "")
            if not header.startswith("Bearer "):
                raise ApiError("Sign in to continue", 401)
            try:
                payload = jwt.decode(header[7:], JWT_SECRET, algorithms=["HS256"])
            except jwt.PyJWTError:
                raise ApiError("Your session expired. Sign in again.", 401)
            with db().cursor() as c:
                c.execute("SELECT role, token_version FROM users WHERE id = %s", (int(payload["sub"]),))
                u = c.fetchone()
            if not u or u["token_version"] != payload.get("ver", 0):
                raise ApiError("Your session ended. Sign in again.", 401)
            g.user = {"id": int(payload["sub"]), "role": u["role"]}
            if role and g.user["role"] != role:
                raise ApiError("You don't have access to this area", 403)
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def clean_nickname(value):
    name = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(name) > 30:
        raise ApiError("Account names can be up to 30 characters")
    return name or None


def new_account(c, user_id, kind, nickname=None):
    for _ in range(10):
        number = "VL" + "".join(secrets.choice("0123456789") for _ in range(10))
        c.execute(
            "INSERT INTO accounts(user_id, account_number, type, nickname) VALUES (%s,%s,%s,%s) "
            "ON CONFLICT (account_number) DO NOTHING RETURNING id",
            (user_id, number, kind, nickname),
        )
        row = c.fetchone()
        if row:
            return row["id"]
    raise ApiError("Could not create the account. Try again.", 500)


def daily_used(c, user_id):
    """Money the customer has already sent out today (UTC day)."""
    c.execute(
        """SELECT COALESCE(SUM(t.amount), 0) AS used
           FROM transactions t JOIN accounts a ON a.id = t.from_account
           WHERE a.user_id = %s AND t.status = 'completed' AND t.kind IN ('withdraw', 'transfer')
             AND t.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')""",
        (user_id,),
    )
    return c.fetchone()["used"]


# --------------------------------------------------------------------------
# Fraud detection (rule based risk score, 0-100)
# --------------------------------------------------------------------------
def risk_check(c, src_id, dest_id, amount, balance):
    score, reasons = 0, []

    if amount >= 100000:
        score += 60
        reasons.append("Very large amount")
    elif amount >= 25000:
        score += 30
        reasons.append("Large amount")

    c.execute(
        """SELECT COUNT(*) AS n, COALESCE(AVG(amount), 0) AS avg FROM (
               SELECT amount FROM transactions
               WHERE from_account = %s AND status = 'completed'
               ORDER BY id DESC LIMIT 30) s""",
        (src_id,),
    )
    hist = c.fetchone()
    if hist["n"] >= 3 and amount >= 1000 and amount > 5 * hist["avg"]:
        score += 30
        reasons.append("Much higher than your usual spending")

    c.execute(
        "SELECT COUNT(*) AS n FROM transactions "
        "WHERE from_account = %s AND created_at > now() - interval '10 minutes'",
        (src_id,),
    )
    if c.fetchone()["n"] >= 4:
        score += 40
        reasons.append("Many payments in a short time")

    if dest_id and amount >= 10000:
        c.execute(
            "SELECT 1 FROM transactions WHERE from_account = %s AND to_account = %s "
            "AND status = 'completed' LIMIT 1",
            (src_id, dest_id),
        )
        if not c.fetchone():
            score += 20
            reasons.append("First payment to this recipient")

    if amount >= 5000 and amount > balance * Decimal("0.8"):
        score += 15
        reasons.append("Uses most of the account balance")

    return min(score, 100), reasons


def run_outgoing(kind, uid, src_id, dest_number, amount, note):
    """Withdraw or transfer. One DB transaction, rows locked in id order. Returns a result dict."""
    conn = db()
    with conn.cursor() as c:
        dest_id = None
        if kind == "transfer":
            c.execute("SELECT id FROM accounts WHERE account_number = %s", (dest_number,))
            row = c.fetchone()
            if not row:
                raise ApiError("No account found with that number", 404)
            dest_id = row["id"]
            if dest_id == src_id:
                raise ApiError("Choose a different receiving account")

        ids = sorted(i for i in (src_id, dest_id) if i)
        c.execute("SELECT * FROM accounts WHERE id = ANY(%s) ORDER BY id FOR UPDATE", (ids,))
        rows = {r["id"]: r for r in c.fetchall()}

        src = rows.get(src_id)
        if not src or src["user_id"] != uid:
            raise ApiError("Account not found", 404)
        if src["status"] != "active":
            raise ApiError("This account is frozen. Unfreeze it under Security to continue.", 403)
        if dest_id and rows[dest_id]["status"] != "active":
            raise ApiError("The receiving account can't accept payments right now", 409)
        if amount > src["balance"]:
            raise ApiError("Your balance is too low for this amount", 409)
        used = daily_used(c, uid)
        if used + amount > DAILY_LIMIT:
            left = max(DAILY_LIMIT - used, Decimal("0"))
            raise ApiError(f"This would pass your daily limit of {DAILY_LIMIT:,.0f}. You can still send {left:,.2f} today.", 409)

        score, reasons = risk_check(c, src_id, dest_id, amount, src["balance"])
        blocked = score >= BLOCK_AT
        status = "blocked" if blocked else "completed"

        c.execute(
            "INSERT INTO transactions(kind, from_account, to_account, amount, note, status, risk_score) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (kind, src_id, dest_id, amount, note, status, score),
        )
        tid = c.fetchone()["id"]

        if not blocked:
            c.execute("UPDATE accounts SET balance = balance - %s WHERE id = %s", (amount, src_id))
            if dest_id:
                c.execute("UPDATE accounts SET balance = balance + %s WHERE id = %s", (amount, dest_id))

        if score >= ALERT_AT:
            c.execute(
                "INSERT INTO fraud_alerts(transaction_id, user_id, reason, risk_score) VALUES (%s,%s,%s,%s)",
                (tid, uid, "; ".join(reasons), score),
            )
        if blocked:
            notify(c, uid, "Payment held for review",
                   f"{amount:,.2f} {CURRENCY} was held while we check it. No money moved.", "warning")
        elif dest_id and rows[dest_id]["user_id"] != uid:
            notify(c, rows[dest_id]["user_id"], "Money received",
                   f"You received {amount:,.2f} {CURRENCY} in account {rows[dest_id]['account_number']}.", "success")
        audit(c, uid, f"{kind}_{status}", f"tx={tid} amount={amount} risk={score}")
    conn.commit()

    if blocked:
        return {
            "status": "blocked", "transaction_id": tid, "risk_score": score, "reasons": reasons,
            "message": "Payment held for review: " + ", ".join(reasons).lower() + ". No money was moved.",
        }
    return {
        "status": "completed", "transaction_id": tid, "risk_score": score, "reasons": reasons,
        "flagged": score >= ALERT_AT,
        "message": "Payment completed" + (". We flagged it for a security review." if score >= ALERT_AT else "."),
    }


def respond_outgoing(result):
    return ok(result, 202 if result["status"] == "blocked" else 200)


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def check_password_rules(password):
    if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise ApiError("Password needs at least 8 characters, with letters and numbers")


@app.post("/api/register")
def register():
    d = body()
    name = str(d.get("full_name", "")).strip()
    email = str(d.get("email", "")).strip().lower()
    password = str(d.get("password", ""))
    if len(name) < 2:
        raise ApiError("Enter your full name")
    if not EMAIL_RE.match(email):
        raise ApiError("Enter a valid email address")
    check_password_rules(password)

    conn = db()
    with conn.cursor() as c:
        c.execute("SELECT 1 FROM users WHERE email = %s", (email,))
        if c.fetchone():
            raise ApiError("An account with this email already exists", 409)
        role = "admin" if ADMIN_EMAIL and email == ADMIN_EMAIL else "customer"
        c.execute(
            "INSERT INTO users(full_name, email, password_hash, role) VALUES (%s,%s,%s,%s) RETURNING id",
            (name, email, generate_password_hash(password), role),
        )
        uid = c.fetchone()["id"]
        new_account(c, uid, "savings")
        audit(c, uid, "register", email)
    conn.commit()
    return ok({"token": make_token(uid, 0), "role": role}, 201)


def make_token(uid, version):
    exp = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=12)
    return jwt.encode({"sub": str(uid), "ver": version, "exp": exp}, JWT_SECRET, algorithm="HS256")


@app.post("/api/login")
def login():
    d = body()
    email = str(d.get("email", "")).strip().lower()
    password = str(d.get("password", ""))
    conn = db()
    with conn.cursor() as c:
        c.execute(
            "SELECT *, (locked_until IS NOT NULL AND locked_until > now()) AS is_locked "
            "FROM users WHERE email = %s FOR UPDATE",
            (email,),
        )
        u = c.fetchone()
        if u and u["is_locked"]:
            raise ApiError("Too many failed attempts. Try again in 15 minutes.", 429)

        if not u or not check_password_hash(u["password_hash"], password):
            if u:
                c.execute(
                    """UPDATE users SET
                         locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END,
                         failed_logins = CASE WHEN failed_logins + 1 >= 5 THEN 0 ELSE failed_logins + 1 END
                       WHERE id = %s RETURNING locked_until > now() AS now_locked""",
                    (u["id"],),
                )
                if c.fetchone()["now_locked"]:
                    c.execute(
                        "INSERT INTO fraud_alerts(user_id, reason, risk_score) VALUES (%s,%s,%s)",
                        (u["id"], "Account locked after 5 failed sign-in attempts", 60),
                    )
                    notify(c, u["id"], "Sign-in locked", "Too many wrong passwords. Sign-in is paused for 15 minutes.", "warning")
                audit(c, u["id"], "login_failed", email)
            conn.commit()
            raise ApiError("Email or password is incorrect", 401)

        c.execute("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = %s", (u["id"],))
        audit(c, u["id"], "login", email)
    conn.commit()
    return ok({"token": make_token(u["id"], u["token_version"]), "role": u["role"]})


# --------------------------------------------------------------------------
# Accounts
# --------------------------------------------------------------------------
@app.get("/api/me")
@auth()
def me():
    uid = g.user["id"]
    with db().cursor() as c:
        c.execute("SELECT id, full_name, email, role FROM users WHERE id = %s", (uid,))
        user = c.fetchone()
        if not user:
            raise ApiError("Your session expired. Sign in again.", 401)
        c.execute(
            "SELECT id, account_number, nickname, type, balance, status, created_at "
            "FROM accounts WHERE user_id = %s ORDER BY id", (uid,))
        accounts = c.fetchall()
        used = daily_used(c, uid)
        c.execute(
            "SELECT COALESCE(SUM(t.amount), 0) AS n FROM transactions t JOIN accounts a ON a.id = t.to_account "
            "WHERE a.user_id = %s AND t.kind = 'interest' AND t.created_at > now() - interval '30 days'", (uid,))
        interest_30d = c.fetchone()["n"]
        c.execute("SELECT COUNT(*) AS n FROM fraud_alerts WHERE user_id = %s AND status = 'open'", (uid,))
        open_alerts = c.fetchone()["n"]
    return ok({
        "user": user, "accounts": accounts, "currency": CURRENCY, "open_alerts": open_alerts,
        "daily_limit": DAILY_LIMIT, "daily_used": used, "interest_30d": interest_30d, "apy": SAVINGS_APY,
        "total_balance": sum((a["balance"] for a in accounts), Decimal("0")),
    })


@app.post("/api/accounts")
@auth()
def open_account():
    d = body()
    kind = d.get("type", "savings")
    if kind not in ("savings", "current"):
        raise ApiError("Choose savings or current")
    nickname = clean_nickname(d.get("nickname"))
    conn, uid = db(), g.user["id"]
    with conn.cursor() as c:
        c.execute("SELECT COUNT(*) AS n FROM accounts WHERE user_id = %s", (uid,))
        if c.fetchone()["n"] >= MAX_ACCOUNTS:
            raise ApiError(f"You can have up to {MAX_ACCOUNTS} accounts")
        aid = new_account(c, uid, kind, nickname)
        audit(c, uid, "account_opened", f"account={aid} type={kind}")
    conn.commit()
    return ok({"id": aid}, 201)


@app.post("/api/accounts/<int:account_id>/rename")
@auth()
def rename_account(account_id):
    nickname = clean_nickname(body().get("nickname"))
    conn, uid = db(), g.user["id"]
    with conn.cursor() as c:
        c.execute("UPDATE accounts SET nickname = %s WHERE id = %s AND user_id = %s RETURNING id",
                  (nickname, account_id, uid))
        if not c.fetchone():
            raise ApiError("Account not found", 404)
    conn.commit()
    return ok({"nickname": nickname})


@app.post("/api/accounts/freeze-all")
@auth()
def freeze_all():
    frozen = bool(body().get("frozen", True))
    conn, uid = db(), g.user["id"]
    with conn.cursor() as c:
        c.execute("UPDATE accounts SET status = %s WHERE user_id = %s",
                  ("frozen" if frozen else "active", uid))
        audit(c, uid, "freeze_all" if frozen else "unfreeze_all", "")
    conn.commit()
    return ok({"status": "frozen" if frozen else "active"})


@app.post("/api/accounts/<int:account_id>/freeze")
@auth()
def freeze(account_id):
    frozen = bool(body().get("frozen", True))
    conn, uid = db(), g.user["id"]
    with conn.cursor() as c:
        c.execute(
            "UPDATE accounts SET status = %s WHERE id = %s AND user_id = %s RETURNING id",
            ("frozen" if frozen else "active", account_id, uid),
        )
        if not c.fetchone():
            raise ApiError("Account not found", 404)
        audit(c, uid, "account_frozen" if frozen else "account_unfrozen", f"account={account_id}")
    conn.commit()
    return ok({"status": "frozen" if frozen else "active"})


# --------------------------------------------------------------------------
# Money movement
# --------------------------------------------------------------------------
@app.post("/api/deposit")
@auth()
def deposit():
    d = body()
    amount = parse_amount(d.get("amount"))
    note = str(d.get("note", "")).strip()[:140]
    try:
        account_id = int(d.get("account_id"))
    except (TypeError, ValueError):
        raise ApiError("Choose an account")
    conn, uid = db(), g.user["id"]
    with conn.cursor() as c:
        c.execute("SELECT * FROM accounts WHERE id = %s FOR UPDATE", (account_id,))
        acc = c.fetchone()
        if not acc or acc["user_id"] != uid:
            raise ApiError("Account not found", 404)
        if acc["status"] != "active":
            raise ApiError("This account is frozen. Unfreeze it under Security to continue.", 403)
        score = 40 if amount >= 100000 else 0
        c.execute(
            "INSERT INTO transactions(kind, to_account, amount, note, risk_score) "
            "VALUES ('deposit',%s,%s,%s,%s) RETURNING id", (account_id, amount, note, score))
        tid = c.fetchone()["id"]
        c.execute("UPDATE accounts SET balance = balance + %s WHERE id = %s", (amount, account_id))
        if score:
            c.execute(
                "INSERT INTO fraud_alerts(transaction_id, user_id, reason, risk_score) VALUES (%s,%s,%s,%s)",
                (tid, uid, "Very large deposit", score))
        audit(c, uid, "deposit", f"tx={tid} amount={amount}")
    conn.commit()
    return ok({"status": "completed", "transaction_id": tid, "message": "Deposit added to your account."})


@app.post("/api/withdraw")
@auth()
def withdraw():
    d = body()
    amount = parse_amount(d.get("amount"))
    try:
        account_id = int(d.get("account_id"))
    except (TypeError, ValueError):
        raise ApiError("Choose an account")
    return respond_outgoing(run_outgoing("withdraw", g.user["id"], account_id, None, amount, str(d.get("note", "")).strip()[:140]))


@app.post("/api/transfer")
@auth()
def transfer():
    d = body()
    amount = parse_amount(d.get("amount"))
    try:
        src_id = int(d.get("from_account_id"))
    except (TypeError, ValueError):
        raise ApiError("Choose an account to send from")
    number = str(d.get("to_account_number", "")).strip().upper()
    if not number:
        raise ApiError("Enter the receiving account number")
    return respond_outgoing(run_outgoing("transfer", g.user["id"], src_id, number, amount, str(d.get("note", "")).strip()[:140]))


@app.get("/api/transactions")
@auth()
def transactions():
    uid = g.user["id"]
    limit = min(max(request.args.get("limit", 50, type=int), 1), 200)
    before_id = request.args.get("before_id", type=int)
    sql = """
        SELECT t.id, t.kind, t.amount, t.note, t.status, t.risk_score, t.created_at,
               fa.account_number AS from_number, ta.account_number AS to_number,
               COALESCE(fa.user_id = %s, false) AS from_mine,
               COALESCE(ta.user_id = %s, false) AS to_mine
        FROM transactions t
        LEFT JOIN accounts fa ON fa.id = t.from_account
        LEFT JOIN accounts ta ON ta.id = t.to_account
        WHERE (fa.user_id = %s OR ta.user_id = %s)
          AND (t.status = 'completed' OR fa.user_id = %s)
    """
    params = [uid] * 5
    if before_id:
        sql += " AND t.id < %s"
        params.append(before_id)
    account_id = request.args.get("account_id", type=int)
    if account_id:
        sql += " AND (t.from_account = %s OR t.to_account = %s)"
        params += [account_id, account_id]
    q = request.args.get("q", "").strip()
    if q:
        sql += " AND (t.note ILIKE %s OR fa.account_number ILIKE %s OR ta.account_number ILIKE %s OR t.kind ILIKE %s)"
        params += [f"%{q}%"] * 4
    sql += " ORDER BY t.id DESC LIMIT %s"
    params.append(limit)
    with db().cursor() as c:
        c.execute(sql, params)
        rows = c.fetchall()
        return ok({"transactions": rows, "next_before": rows[-1]["id"] if len(rows) == limit else None})


@app.get("/api/alerts")
@auth()
def my_alerts():
    with db().cursor() as c:
        c.execute(
            """SELECT a.id, a.reason, a.risk_score, a.status, a.created_at, t.amount, t.kind, t.status AS tx_status
               FROM fraud_alerts a LEFT JOIN transactions t ON t.id = a.transaction_id
               WHERE a.user_id = %s ORDER BY a.id DESC LIMIT 30""",
            (g.user["id"],))
        return ok({"alerts": c.fetchall()})


# --------------------------------------------------------------------------
# Admin / fraud team
# --------------------------------------------------------------------------
@app.get("/api/admin/overview")
@auth("admin")
def admin_overview():
    with db().cursor() as c:
        c.execute("""SELECT
            (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM accounts) AS accounts,
            (SELECT COUNT(*) FROM transactions WHERE status = 'completed') AS transactions,
            (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE status = 'completed') AS volume,
            (SELECT COUNT(*) FROM transactions WHERE status = 'blocked') AS blocked,
            (SELECT COUNT(*) FROM fraud_alerts WHERE status = 'open') AS open_alerts""")
        stats = c.fetchone()
        c.execute(
            """SELECT a.id, a.reason, a.risk_score, a.status, a.created_at, u.email, u.full_name,
                      t.amount, t.kind, t.status AS tx_status
               FROM fraud_alerts a JOIN users u ON u.id = a.user_id
               LEFT JOIN transactions t ON t.id = a.transaction_id
               ORDER BY (a.status = 'open') DESC, a.id DESC LIMIT 50""")
        alerts = c.fetchall()
        c.execute(
            """SELECT t.id, t.kind, t.amount, t.status, t.risk_score, t.created_at,
                      fa.account_number AS from_number, ta.account_number AS to_number
               FROM transactions t
               LEFT JOIN accounts fa ON fa.id = t.from_account
               LEFT JOIN accounts ta ON ta.id = t.to_account
               ORDER BY t.id DESC LIMIT 30""")
        recent = c.fetchall()
    return ok({"stats": stats, "alerts": alerts, "recent": recent})


@app.post("/api/admin/alerts/<int:alert_id>")
@auth("admin")
def admin_resolve(alert_id):
    action = body().get("status")
    if action not in ("dismissed", "confirmed", "released", "rejected"):
        raise ApiError("Choose a valid review action")
    conn = db()
    with conn.cursor() as c:
        c.execute(
            "SELECT a.id, a.status, a.user_id, a.transaction_id, t.status AS tx_status, t.from_account, "
            "t.to_account, t.amount FROM fraud_alerts a "
            "LEFT JOIN transactions t ON t.id = a.transaction_id WHERE a.id = %s FOR UPDATE OF a",
            (alert_id,))
        row = c.fetchone()
        if not row:
            raise ApiError("Alert not found", 404)
        if row["status"] != "open":
            raise ApiError("This alert was already reviewed", 409)
        held = row["tx_status"] == "blocked"
        dest = None

        if action in ("released", "rejected") and not held:
            raise ApiError("This alert has no held payment")
        if action == "dismissed" and held:
            raise ApiError("Release or reject the held payment first")

        if action == "released":
            ids = sorted(i for i in (row["from_account"], row["to_account"]) if i)
            c.execute("SELECT * FROM accounts WHERE id = ANY(%s) ORDER BY id FOR UPDATE", (ids,))
            accs = {r["id"]: r for r in c.fetchall()}
            src, dest = accs.get(row["from_account"]), accs.get(row["to_account"])
            if not src or src["status"] != "active" or (row["to_account"] and (not dest or dest["status"] != "active")):
                raise ApiError("Can't release: an account is frozen or missing", 409)
            if src["balance"] < row["amount"]:
                raise ApiError("Can't release: the sender's balance is now too low", 409)
            c.execute("UPDATE accounts SET balance = balance - %s WHERE id = %s", (row["amount"], src["id"]))
            if dest:
                c.execute("UPDATE accounts SET balance = balance + %s WHERE id = %s", (row["amount"], dest["id"]))
            c.execute("UPDATE transactions SET status = 'completed' WHERE id = %s", (row["transaction_id"],))
        elif action == "rejected":
            c.execute("UPDATE transactions SET status = 'rejected' WHERE id = %s", (row["transaction_id"],))
        elif action == "confirmed":
            if row["from_account"]:
                c.execute("UPDATE accounts SET status = 'frozen' WHERE id = %s", (row["from_account"],))
            if held:
                c.execute("UPDATE transactions SET status = 'rejected' WHERE id = %s", (row["transaction_id"],))

        what = f"{row['amount']:,.2f} {CURRENCY} payment" if row["amount"] else "account activity"
        messages = {
            "released": ("Payment released", f"Your held {what} was reviewed and sent.", "success"),
            "rejected": ("Payment rejected", f"Your held {what} was reviewed and rejected. No money moved.", "warning"),
            "confirmed": ("Fraud confirmed", "We froze the affected account to protect you. Review it under Security.", "danger"),
            "dismissed": ("Alert cleared", f"We reviewed the alert on your {what} and found no problem.", "success"),
        }
        notify(c, row["user_id"], *messages[action])
        if action == "released" and dest and dest["user_id"] != row["user_id"]:
            notify(c, dest["user_id"], "Money received",
                   f"You received {row['amount']:,.2f} {CURRENCY} in account {dest['account_number']}.", "success")
        c.execute(
            "UPDATE fraud_alerts SET status = %s, reviewed_by = %s, reviewed_at = now() WHERE id = %s",
            (action, g.user["id"], alert_id))
        audit(c, g.user["id"], f"alert_{action}", f"alert={alert_id}")
    conn.commit()
    return ok({"status": action})


# --------------------------------------------------------------------------
# Statements (CSV download)
# --------------------------------------------------------------------------
def csv_safe(value):
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def parse_day(value, label):
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        raise ApiError(f"Enter the {label} date as YYYY-MM-DD")


@app.get("/api/statement")
@auth()
def statement():
    account_id = request.args.get("account_id", type=int)
    start = parse_day(request.args.get("from"), "start")
    stop = parse_day(request.args.get("to"), "end")
    if not account_id:
        raise ApiError("Choose an account for the statement")
    with db().cursor() as c:
        c.execute("SELECT * FROM accounts WHERE id = %s AND user_id = %s", (account_id, g.user["id"]))
        acc = c.fetchone()
        if not acc:
            raise ApiError("Account not found", 404)
        c.execute(
            """SELECT t.id, t.kind, t.amount, t.note, t.created_at, t.from_account,
                      fa.account_number AS from_number, ta.account_number AS to_number
               FROM transactions t
               LEFT JOIN accounts fa ON fa.id = t.from_account
               LEFT JOIN accounts ta ON ta.id = t.to_account
               WHERE t.status = 'completed' AND (t.from_account = %s OR t.to_account = %s)
               ORDER BY t.id DESC LIMIT 5000""",
            (account_id, account_id))
        rows = c.fetchall()

    balance, lines = acc["balance"], []
    for r in rows:  # walk backwards from today's balance to get a balance after each row
        outgoing_row = r["from_account"] == account_id
        lines.append((r, outgoing_row, balance))
        balance = balance + r["amount"] if outgoing_row else balance - r["amount"]

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Vaultline statement", acc["account_number"], acc["nickname"] or acc["type"]])
    w.writerow(["Date (UTC)", "Description", "Reference", "Money out", "Money in", "Balance"])
    for r, is_out, bal_after in reversed(lines):
        day = r["created_at"].date()
        if (start and day < start) or (stop and day > stop):
            continue
        if r["kind"] == "deposit":
            desc = "Deposit"
        elif r["kind"] == "withdraw":
            desc = "Withdrawal"
        elif r["kind"] == "interest":
            desc = "Interest"
        else:
            desc = f"Sent to {r['to_number']}" if is_out else f"Received from {r['from_number']}"
        if r["note"]:
            desc += f" - {r['note']}"
        w.writerow([r["created_at"].strftime("%Y-%m-%d %H:%M"), csv_safe(desc), f"TX{r['id']}",
                    f"{r['amount']:.2f}" if is_out else "", "" if is_out else f"{r['amount']:.2f}",
                    f"{bal_after:.2f}"])
    w.writerow([])
    w.writerow(["Current balance", f"{acc['balance']:.2f}", CURRENCY])
    filename = f"vaultline-statement-{re.sub(r'[^A-Za-z0-9]', '', acc['account_number'])}.csv"
    return Response(out.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# --------------------------------------------------------------------------
# Security center: sign-in history, password change, sign out everywhere
# --------------------------------------------------------------------------
@app.get("/api/security/activity")
@auth()
def security_activity():
    with db().cursor() as c:
        c.execute(
            "SELECT action, ip, created_at FROM audit_logs WHERE user_id = %s AND action IN "
            "('login','login_failed','register','password_changed','sessions_revoked','freeze_all','unfreeze_all') "
            "ORDER BY id DESC LIMIT 12", (g.user["id"],))
        return ok({"events": c.fetchall()})


@app.post("/api/security/revoke-sessions")
@auth()
def revoke_sessions():
    conn, uid = db(), g.user["id"]
    with conn.cursor() as c:
        c.execute("UPDATE users SET token_version = token_version + 1 WHERE id = %s RETURNING token_version", (uid,))
        version = c.fetchone()["token_version"]
        audit(c, uid, "sessions_revoked", "")
    conn.commit()
    return ok({"token": make_token(uid, version)})


@app.post("/api/security/password")
@auth()
def change_password():
    d = body()
    current, new = str(d.get("current_password", "")), str(d.get("new_password", ""))
    check_password_rules(new)
    conn, uid = db(), g.user["id"]
    with conn.cursor() as c:
        c.execute("SELECT password_hash FROM users WHERE id = %s FOR UPDATE", (uid,))
        row = c.fetchone()
        if not row or not check_password_hash(row["password_hash"], current):
            raise ApiError("Your current password is incorrect", 400)
        c.execute(
            "UPDATE users SET password_hash = %s, token_version = token_version + 1 WHERE id = %s RETURNING token_version",
            (generate_password_hash(new), uid))
        version = c.fetchone()["token_version"]
        notify(c, uid, "Password changed", "Your password was changed and other devices were signed out.", "info")
        audit(c, uid, "password_changed", "")
    conn.commit()
    return ok({"token": make_token(uid, version), "message": "Password changed. Other devices were signed out."})


# --------------------------------------------------------------------------
# Daily job (Vercel Cron): savings interest + scheduled payments
# --------------------------------------------------------------------------
def pay_interest(conn):
    paid = 0
    with conn.cursor() as c:
        c.execute(
            "SELECT id, balance FROM accounts WHERE type = 'savings' AND status = 'active' AND balance > 0 "
            "AND (last_interest_on IS NULL OR last_interest_on < CURRENT_DATE) FOR UPDATE SKIP LOCKED")
        for a in c.fetchall():
            interest = (a["balance"] * SAVINGS_APY / Decimal(100) / Decimal(365)).quantize(Decimal("0.01"), ROUND_HALF_UP)
            if interest > 0:
                c.execute(
                    "INSERT INTO transactions(kind, to_account, amount, note) VALUES ('interest', %s, %s, 'Daily interest')",
                    (a["id"], interest))
                c.execute("UPDATE accounts SET balance = balance + %s WHERE id = %s", (interest, a["id"]))
                paid += 1
            c.execute("UPDATE accounts SET last_interest_on = CURRENT_DATE WHERE id = %s", (a["id"],))
    conn.commit()
    return paid


def run_scheduled(conn):
    with conn.cursor() as c:
        c.execute("SELECT * FROM scheduled_payments WHERE active AND next_run <= CURRENT_DATE ORDER BY id LIMIT 200")
        due = c.fetchall()
    done = 0
    for item in due:
        try:
            result = run_outgoing("transfer", item["user_id"], item["from_account"], item["to_account_number"],
                                  item["amount"], item["note"] or "Scheduled payment")
            status = "Held for review" if result["status"] == "blocked" else "Completed"
            title = "Scheduled payment held" if result["status"] == "blocked" else "Scheduled payment sent"
            kind = "warning" if result["status"] == "blocked" else "success"
            body = f"{item['amount']:,.2f} {CURRENCY} to {item['to_account_number']}."
        except ApiError as e:
            conn.rollback()
            status, title, kind = "Failed: " + e.message, "Scheduled payment failed", "danger"
            body = f"{item['amount']:,.2f} {CURRENCY} to {item['to_account_number']}. {e.message}"
        with conn.cursor() as c:
            if item["frequency"] == "once":
                c.execute("UPDATE scheduled_payments SET active = false, last_status = %s WHERE id = %s", (status, item["id"]))
            elif item["frequency"] == "weekly":
                c.execute("UPDATE scheduled_payments SET next_run = next_run + 7, last_status = %s WHERE id = %s", (status, item["id"]))
            else:
                c.execute("UPDATE scheduled_payments SET next_run = (next_run + interval '1 month')::date, last_status = %s WHERE id = %s",
                          (status, item["id"]))
            notify(c, item["user_id"], title, body, kind)
        conn.commit()
        done += 1
    return done


@app.route("/api/cron/daily", methods=["GET", "POST"])
@app.route("/api/cron/interest", methods=["GET", "POST"])
def cron_daily():
    supplied = request.headers.get("Authorization", "")
    if not CRON_SECRET or not hmac.compare_digest(supplied, f"Bearer {CRON_SECRET}"):
        raise ApiError("Forbidden", 403)
    conn = db()
    return ok({"accounts_paid": pay_interest(conn), "scheduled_run": run_scheduled(conn)})


# --------------------------------------------------------------------------
# Recipients: lookup, saved payees
# --------------------------------------------------------------------------
@app.get("/api/lookup")
@auth()
def lookup():
    number = request.args.get("account_number", "").strip().upper()
    if not re.fullmatch(r"VL\d{10}", number):
        return ok({"found": False})
    with db().cursor() as c:
        c.execute(
            "SELECT a.type, a.user_id, a.status, u.full_name FROM accounts a "
            "JOIN users u ON u.id = a.user_id WHERE a.account_number = %s", (number,))
        r = c.fetchone()
    if not r:
        return ok({"found": False})
    return ok({"found": True, "holder": mask_name(r["full_name"]), "type": r["type"],
               "is_mine": r["user_id"] == g.user["id"], "frozen": r["status"] != "active"})


@app.get("/api/payees")
@auth()
def list_payees():
    with db().cursor() as c:
        c.execute("SELECT id, name, account_number FROM payees WHERE user_id = %s ORDER BY lower(name)", (g.user["id"],))
        return ok({"payees": c.fetchall()})


@app.post("/api/payees")
@auth()
def add_payee():
    d = body()
    name = re.sub(r"\s+", " ", str(d.get("name", ""))).strip()
    number = str(d.get("account_number", "")).strip().upper()
    if not 1 <= len(name) <= 40:
        raise ApiError("Give this recipient a name (up to 40 characters)")
    conn, uid = db(), g.user["id"]
    with conn.cursor() as c:
        c.execute("SELECT user_id FROM accounts WHERE account_number = %s", (number,))
        acc = c.fetchone()
        if not acc:
            raise ApiError("No account found with that number", 404)
        if acc["user_id"] == uid:
            raise ApiError("That is one of your own accounts")
        c.execute("SELECT COUNT(*) AS n FROM payees WHERE user_id = %s", (uid,))
        if c.fetchone()["n"] >= 50:
            raise ApiError("You can save up to 50 recipients")
        c.execute(
            "INSERT INTO payees(user_id, name, account_number) VALUES (%s,%s,%s) "
            "ON CONFLICT (user_id, account_number) DO UPDATE SET name = EXCLUDED.name RETURNING id",
            (uid, name, number))
        pid = c.fetchone()["id"]
    conn.commit()
    return ok({"id": pid}, 201)


@app.delete("/api/payees/<int:payee_id>")
@auth()
def delete_payee(payee_id):
    conn = db()
    with conn.cursor() as c:
        c.execute("DELETE FROM payees WHERE id = %s AND user_id = %s RETURNING id", (payee_id, g.user["id"]))
        if not c.fetchone():
            raise ApiError("Recipient not found", 404)
    conn.commit()
    return ok({"deleted": True})


# --------------------------------------------------------------------------
# Notifications, receipts, profile
# --------------------------------------------------------------------------
@app.get("/api/notifications")
@auth()
def notifications():
    with db().cursor() as c:
        c.execute("SELECT id, kind, title, body, is_read, created_at FROM notifications "
                  "WHERE user_id = %s ORDER BY id DESC LIMIT 30", (g.user["id"],))
        items = c.fetchall()
        c.execute("SELECT COUNT(*) AS n FROM notifications WHERE user_id = %s AND NOT is_read", (g.user["id"],))
        unread = c.fetchone()["n"]
    return ok({"notifications": items, "unread": unread})


@app.post("/api/notifications/read")
@auth()
def notifications_read():
    conn = db()
    with conn.cursor() as c:
        c.execute("UPDATE notifications SET is_read = true WHERE user_id = %s AND NOT is_read", (g.user["id"],))
    conn.commit()
    return ok({"ok": True})


@app.get("/api/transactions/<int:tx_id>")
@auth()
def transaction_detail(tx_id):
    uid = g.user["id"]
    with db().cursor() as c:
        c.execute(
            """SELECT t.id, t.kind, t.amount, t.note, t.status, t.risk_score, t.created_at,
                      fa.account_number AS from_number, ta.account_number AS to_number,
                      fa.user_id AS from_user, ta.user_id AS to_user,
                      fu.full_name AS from_name, tu.full_name AS to_name,
                      (SELECT reason FROM fraud_alerts WHERE transaction_id = t.id ORDER BY id DESC LIMIT 1) AS alert_reason,
                      (SELECT status FROM fraud_alerts WHERE transaction_id = t.id ORDER BY id DESC LIMIT 1) AS alert_status
               FROM transactions t
               LEFT JOIN accounts fa ON fa.id = t.from_account
               LEFT JOIN accounts ta ON ta.id = t.to_account
               LEFT JOIN users fu ON fu.id = fa.user_id
               LEFT JOIN users tu ON tu.id = ta.user_id
               WHERE t.id = %s""", (tx_id,))
        t = c.fetchone()
    if not t or uid not in (t["from_user"], t["to_user"]) or (t["status"] != "completed" and t["from_user"] != uid):
        raise ApiError("Payment not found", 404)
    from_mine, to_mine = t["from_user"] == uid, t["to_user"] == uid
    return ok({
        "id": t["id"], "reference": f"TX{t['id']}", "kind": t["kind"], "amount": t["amount"], "note": t["note"],
        "status": t["status"], "risk_score": t["risk_score"], "created_at": t["created_at"],
        "from_number": t["from_number"], "to_number": t["to_number"],
        "from_name": (t["from_name"] if from_mine else mask_name(t["from_name"])) if t["from_name"] else None,
        "to_name": (t["to_name"] if to_mine else mask_name(t["to_name"])) if t["to_name"] else None,
        "from_mine": from_mine, "to_mine": to_mine,
        "alert_reason": t["alert_reason"] if from_mine else None,
        "alert_status": t["alert_status"] if from_mine else None,
    })


@app.post("/api/profile")
@auth()
def update_profile():
    name = re.sub(r"\s+", " ", str(body().get("full_name", ""))).strip()
    if not 2 <= len(name) <= 60:
        raise ApiError("Enter your full name (2 to 60 characters)")
    conn = db()
    with conn.cursor() as c:
        c.execute("UPDATE users SET full_name = %s WHERE id = %s", (name, g.user["id"]))
    conn.commit()
    return ok({"full_name": name})


# --------------------------------------------------------------------------
# Scheduled payments
# --------------------------------------------------------------------------
@app.get("/api/scheduled")
@auth()
def list_scheduled():
    with db().cursor() as c:
        c.execute(
            """SELECT s.id, s.amount, s.note, s.frequency, s.next_run, s.last_status, s.to_account_number,
                      a.account_number AS from_number, a.nickname AS from_name
               FROM scheduled_payments s JOIN accounts a ON a.id = s.from_account
               WHERE s.user_id = %s AND s.active ORDER BY s.next_run, s.id""", (g.user["id"],))
        return ok({"scheduled": c.fetchall()})


@app.post("/api/scheduled")
@auth()
def create_scheduled():
    d = body()
    amount = parse_amount(d.get("amount"))
    freq = d.get("frequency")
    if freq not in ("once", "weekly", "monthly"):
        raise ApiError("Choose once, weekly or monthly")
    try:
        src_id = int(d.get("from_account_id"))
    except (TypeError, ValueError):
        raise ApiError("Choose an account to pay from")
    number = str(d.get("to_account_number", "")).strip().upper()
    start = parse_day(d.get("start_date"), "start")
    today = dt.datetime.now(dt.timezone.utc).date()
    if not start or start < today:
        raise ApiError("Pick a start date from today onwards")
    conn, uid = db(), g.user["id"]
    with conn.cursor() as c:
        c.execute("SELECT 1 FROM accounts WHERE id = %s AND user_id = %s", (src_id, uid))
        if not c.fetchone():
            raise ApiError("Account not found", 404)
        c.execute("SELECT id FROM accounts WHERE account_number = %s", (number,))
        dest = c.fetchone()
        if not dest:
            raise ApiError("No account found with that number", 404)
        if dest["id"] == src_id:
            raise ApiError("Choose a different receiving account")
        c.execute("SELECT COUNT(*) AS n FROM scheduled_payments WHERE user_id = %s AND active", (uid,))
        if c.fetchone()["n"] >= 10:
            raise ApiError("You can have up to 10 scheduled payments")
        c.execute(
            "INSERT INTO scheduled_payments(user_id, from_account, to_account_number, amount, note, frequency, next_run) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
            (uid, src_id, number, amount, str(d.get("note", "")).strip()[:140], freq, start))
        sid = c.fetchone()["id"]
        audit(c, uid, "scheduled_created", f"id={sid} amount={amount} freq={freq}")
    conn.commit()
    return ok({"id": sid, "message": "Scheduled. Payments run each morning at 00:00 UTC."}, 201)


@app.delete("/api/scheduled/<int:sid>")
@auth()
def cancel_scheduled(sid):
    conn = db()
    with conn.cursor() as c:
        c.execute("UPDATE scheduled_payments SET active = false WHERE id = %s AND user_id = %s AND active RETURNING id",
                  (sid, g.user["id"]))
        if not c.fetchone():
            raise ApiError("Scheduled payment not found", 404)
    conn.commit()
    return ok({"cancelled": True})


# --------------------------------------------------------------------------
# Admin: customers and audit trail
# --------------------------------------------------------------------------
@app.get("/api/admin/users")
@auth("admin")
def admin_users():
    with db().cursor() as c:
        c.execute(
            """SELECT u.id, u.full_name, u.email, u.role, u.created_at,
                      (u.locked_until IS NOT NULL AND u.locked_until > now()) AS locked,
                      COUNT(a.id) AS accounts, COALESCE(SUM(a.balance), 0) AS balance,
                      COUNT(a.id) FILTER (WHERE a.status = 'frozen') AS frozen
               FROM users u LEFT JOIN accounts a ON a.user_id = u.id
               GROUP BY u.id ORDER BY u.id DESC LIMIT 100""")
        return ok({"users": c.fetchall()})


@app.post("/api/admin/users/<int:user_id>/unlock")
@auth("admin")
def admin_unlock(user_id):
    conn = db()
    with conn.cursor() as c:
        c.execute("UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE id = %s RETURNING id", (user_id,))
        if not c.fetchone():
            raise ApiError("Customer not found", 404)
        audit(c, g.user["id"], "admin_unlock", f"user={user_id}")
    conn.commit()
    return ok({"ok": True})


@app.post("/api/admin/users/<int:user_id>/freeze")
@auth("admin")
def admin_freeze_user(user_id):
    if user_id == g.user["id"]:
        raise ApiError("Use the Security page to freeze your own accounts")
    frozen = bool(body().get("frozen", True))
    conn = db()
    with conn.cursor() as c:
        c.execute("UPDATE accounts SET status = %s WHERE user_id = %s", ("frozen" if frozen else "active", user_id))
        notify(c, user_id, "Accounts frozen" if frozen else "Accounts unfrozen",
               "Our team froze your accounts while we look into activity." if frozen else "Our team unfroze your accounts.",
               "danger" if frozen else "success")
        audit(c, g.user["id"], "admin_freeze" if frozen else "admin_unfreeze", f"user={user_id}")
    conn.commit()
    return ok({"ok": True})


@app.get("/api/admin/audit")
@auth("admin")
def admin_audit():
    with db().cursor() as c:
        c.execute(
            "SELECT l.id, l.action, l.detail, l.ip, l.created_at, u.email FROM audit_logs l "
            "LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 100")
        return ok({"events": c.fetchall()})


@app.get("/api/health")
def health():
    with db().cursor() as c:
        c.execute("SELECT 1 AS ok")
        c.fetchone()
    return ok({"status": "ok"})


# --------------------------------------------------------------------------
# Local development only: Vercel serves /public from its CDN.
# --------------------------------------------------------------------------
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")


@app.get("/")
def local_home():
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.get("/<path:filename>")
def local_static(filename):
    return send_from_directory(PUBLIC_DIR, filename)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
