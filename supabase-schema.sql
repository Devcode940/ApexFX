-- SUPABASE DATABASE SCHEMA & POLICIES
-- Copy and run this in your Supabase SQL Editor (https://supabase.com)

-- Keys are per-user composites (user_id, id), NOT a global id. The old `id TEXT PRIMARY KEY` meant
-- one local id could belong to exactly one account on the whole project: a second user upserting the
-- same id hit an UPDATE on someone else's row, which RLS then rejected as a policy violation. Client
-- ids are UUIDs now, so collisions are unlikely - but "unlikely" is not a constraint, and the composite
-- key also gives the upsert path a conflict target that is correct by construction.

-- 1. Create drawings table (present for schema completeness: nothing in src/ writes to it today)
CREATE TABLE IF NOT EXISTS public.drawings (
    id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (user_id, id)
);

-- Enable RLS on drawings
ALTER TABLE public.drawings ENABLE ROW LEVEL SECURITY;

-- Setup RLS Policies for drawings
CREATE POLICY "Users can insert their own drawings" ON public.drawings
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can select their own drawings" ON public.drawings
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own drawings" ON public.drawings
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own drawings" ON public.drawings
    FOR DELETE USING (auth.uid() = user_id);


-- 2. Create positions table
CREATE TABLE IF NOT EXISTS public.positions (
    id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL, -- 'BUY' or 'SELL'
    entry_price NUMERIC NOT NULL,
    lots NUMERIC NOT NULL,
    stop_loss NUMERIC,
    take_profit NUMERIC,
    timestamp BIGINT NOT NULL,
    pips NUMERIC,
    profit NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (user_id, id)
);

-- Enable RLS on positions
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

-- Setup RLS Policies for positions
CREATE POLICY "Users can insert their own positions" ON public.positions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can select their own positions" ON public.positions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own positions" ON public.positions
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own positions" ON public.positions
    FOR DELETE USING (auth.uid() = user_id);


-- 3. Create closed_trades table
CREATE TABLE IF NOT EXISTS public.closed_trades (
    id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL,
    entry_price NUMERIC NOT NULL,
    exit_price NUMERIC NOT NULL,
    lots NUMERIC NOT NULL,
    profit NUMERIC NOT NULL,
    pips NUMERIC NOT NULL,
    open_time BIGINT NOT NULL,
    close_time BIGINT NOT NULL,
    close_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (user_id, id)
);

-- Backfill column for databases created before this migration
ALTER TABLE public.closed_trades ADD COLUMN IF NOT EXISTS close_reason TEXT;

-- Enable RLS on closed_trades
ALTER TABLE public.closed_trades ENABLE ROW LEVEL SECURITY;

-- Setup RLS Policies for closed_trades
CREATE POLICY "Users can insert their own closed trades" ON public.closed_trades
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can select their own closed trades" ON public.closed_trades
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own closed trades" ON public.closed_trades
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own closed trades" ON public.closed_trades
    FOR DELETE USING (auth.uid() = user_id);


-- 4. Create profile settings table (Optional, for storing user-preferred indicators)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    preferred_indicators JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Setup RLS Policies for profiles
CREATE POLICY "Users can insert their own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can select their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Create a trigger to automatically create a profile for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id)
    VALUES (new.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================================
-- 5. MIGRATION for databases created before 2026-09-13 (safe to re-run)
--    Run this block if you already applied an earlier version of this file.
--    It converts the three global `id` primary keys into per-user composites.
-- ============================================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['drawings', 'positions', 'closed_trades'] LOOP
    -- Drop the old single-column primary key if that is what exists.
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I_pkey', t, t);

    -- A key column must be NOT NULL. RLS (`auth.uid() = user_id`) already made NULL user_id
    -- impossible for anything a browser inserted, so this only trips on service-role writes.
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id SET NOT NULL', t);

    -- Add the composite key only when the table has none. A catalog check rather than an exception
    -- handler, because "adding a second primary key" raises 42P16 and relying on a PL/pgSQL
    -- condition *name* for it is exactly the kind of detail that silently differs across versions.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', t)::regclass AND contype = 'p'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD PRIMARY KEY (user_id, id)', t);
    END IF;
  END LOOP;
END $$;

-- Fast "my rows, newest first" reads without a sequential scan as the tables grow.
CREATE INDEX IF NOT EXISTS positions_user_created_idx  ON public.positions  (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS closed_trades_user_time_idx ON public.closed_trades (user_id, close_time DESC);

-- Recompute the pips column for closed trades. The client used to store
-- `abs(exit - entry) * (symbol LIKE '%JPY' THEN 100 ELSE 10000)`, which is 100x too large for gold
-- (a 2-decimal instrument) and disagrees with the panel's convention for silver.
-- The CASE below MUST mirror PAIRS_CONFIG in src/utils/forexData.ts; if you change pipDecimal there,
-- change it here too (or drop this statement and let new rows arrive correct).
UPDATE public.closed_trades
SET pips = ROUND(ABS(exit_price - entry_price) / CASE
  WHEN symbol IN ('USDJPY', 'GBPJPY', 'XAUUSD') THEN 0.01
  ELSE 0.0001
END)
WHERE ABS(exit_price - entry_price) > 0;
