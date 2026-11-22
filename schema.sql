-- Optional: run this in your PostgreSQL console to create tables manually.
-- (The API also creates them automatically on the first request.)
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
