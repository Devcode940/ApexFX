-- CUTOVER STEP, after backup and v2 verification. Refresh/retire all old browser tabs.
-- Stops obsolete clients from uploading unscoped/mixed-account rows into the legacy journals.
-- Does not delete rows, rewrite profit/pips, grant new read access, or alter existing RLS policies.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.positions') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE ON public.positions FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regclass('public.closed_trades') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE ON public.closed_trades FROM PUBLIC, anon, authenticated;
  END IF;
END;
$$;
COMMIT;
