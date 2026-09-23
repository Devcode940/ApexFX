-- Additive migration. Run separately in Supabase SQL Editor after backing up the project.
-- Does NOT change/delete/reinterpret positions, closed_trades, drawings, or their historical profit fields.
-- v2 is a bounded paper journal, not an authoritative broker or a general replication service.
BEGIN;
CREATE TABLE IF NOT EXISTS public.paper_books_v2 (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0),
  book jsonb NOT NULL CHECK (jsonb_typeof(book) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paper_books_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paper_books_v2 FROM anon, authenticated;
GRANT SELECT ON public.paper_books_v2 TO authenticated;
DROP POLICY IF EXISTS paper_books_v2_read_own ON public.paper_books_v2;
CREATE POLICY paper_books_v2_read_own ON public.paper_books_v2
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- Bind writes to the identity that initiated the sync, not just whichever token the SDK has
-- when it finally sends. Otherwise A's delayed RPC could authenticate as B after an account switch.
DROP FUNCTION IF EXISTS public.save_paper_book_v2(bigint, jsonb);
CREATE OR REPLACE FUNCTION public.save_paper_book_v2(expected_user_id uuid, expected_revision bigint, next_book jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  owner_id uuid := auth.uid();
  previous public.paper_books_v2%ROWTYPE;
  collection text;
  affected integer;
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF expected_user_id IS NULL OR owner_id <> expected_user_id THEN
    RAISE EXCEPTION 'Account changed during sync' USING ERRCODE = '42501';
  END IF;
  IF expected_revision IS NULL OR expected_revision < 0 OR next_book IS NULL
      OR jsonb_typeof(next_book) <> 'object' OR ((next_book->'version') IS DISTINCT FROM '2'::jsonb)
      OR octet_length(next_book::text) > 2097152 THEN
    RAISE EXCEPTION 'Invalid/oversized v2 book';
  END IF;
  FOREACH collection IN ARRAY ARRAY['positions', 'closedTrades', 'deletedTradeIds', 'closedPositionIds'] LOOP
    IF COALESCE(jsonb_typeof(next_book->collection), '') <> 'array' THEN
      RAISE EXCEPTION 'Missing book collection: %', collection;
    END IF;
    IF jsonb_array_length(next_book->collection) > 5000 THEN RAISE EXCEPTION 'Book limit exceeded'; END IF;
  END LOOP;
  IF expected_revision = 0 THEN
    INSERT INTO public.paper_books_v2(user_id, revision, book) VALUES(owner_id, 1, next_book)
      ON CONFLICT (user_id) DO NOTHING;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected = 1;
  END IF;
  SELECT * INTO previous FROM public.paper_books_v2 WHERE user_id = owner_id FOR UPDATE;
  IF NOT FOUND OR previous.revision <> expected_revision THEN RETURN false; END IF;
  -- Tombstones are monotonic, including on an empty-book push. Only deliberate administrative
  -- archival (with all devices retired) may compact them; clearing visible history is not archival.
  IF NOT ((next_book->'closedPositionIds') @> (previous.book->'closedPositionIds'))
      OR NOT ((next_book->'deletedTradeIds') @> (previous.book->'deletedTradeIds')) THEN
    RAISE EXCEPTION 'A book may not discard closure/deletion tombstones';
  END IF;
  UPDATE public.paper_books_v2 SET book = next_book, revision = revision + 1, updated_at = now()
    WHERE user_id = owner_id AND revision = expected_revision;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.save_paper_book_v2(uuid, bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_paper_book_v2(uuid, bigint, jsonb) TO authenticated;
COMMIT;
