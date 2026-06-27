-- SUPABASE DATABASE SCHEMA & POLICIES
-- Copy and run this in your Supabase SQL Editor (https://supabase.com)

-- 1. Create drawings table
CREATE TABLE IF NOT EXISTS public.drawings (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
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
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL, -- 'BUY' or 'SELL'
    entry_price NUMERIC NOT NULL,
    lots NUMERIC NOT NULL,
    stop_loss NUMERIC,
    take_profit NUMERIC,
    timestamp BIGINT NOT NULL,
    pips NUMERIC,
    profit NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
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
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL,
    entry_price NUMERIC NOT NULL,
    exit_price NUMERIC NOT NULL,
    lots NUMERIC NOT NULL,
    profit NUMERIC NOT NULL,
    pips NUMERIC NOT NULL,
    open_time BIGINT NOT NULL,
    close_time BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

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
