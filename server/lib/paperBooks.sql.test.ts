import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

// Executes real PostgreSQL SQL/roles/RLS in an in-memory WASM fixture. This is NOT a deployed
// Supabase/PostgREST/JWT integration test; those rollout checks remain mandatory.
let db: PGlite;
let expectedUser: string;
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const empty = { version: 2, positions: [], closedTrades: [], deletedTradeIds: [], closedPositionIds: [] };
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    INSERT INTO auth.users VALUES ('${A}'), ('${B}');
    CREATE TABLE public.positions(id text PRIMARY KEY, profit numeric); INSERT INTO positions VALUES ('legacy', 123);
    CREATE TABLE public.closed_trades(id text PRIMARY KEY, profit numeric); INSERT INTO closed_trades VALUES ('legacy', 456);`);
  const migration = await readFile(new URL('../../supabase/migrations/20260923_paper_books.sql', import.meta.url), 'utf8');
  await db.exec(migration);
}, 20_000);
afterAll(async () => { await db?.close(); });
async function asUser(id: string, role = 'authenticated') {
  expectedUser = id || A;
  await db.exec(`RESET ROLE; SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${id}', false);`);
}
async function save(revision: number, book = empty, owner = expectedUser) {
  const { rows } = await db.query<{ saved: boolean }>('SELECT public.save_paper_book_v2($1::uuid, $2::bigint, $3::jsonb) AS saved', [owner, revision, JSON.stringify(book)]);
  return rows[0].saved;
}
describe('additive paper-book SQL migration', () => {
  it('only lets the authenticated owner create/read a book', async () => {
    await asUser(A); expect(await save(0)).toBe(true);
    expect((await db.query<{ user_id: string }>('SELECT user_id FROM public.paper_books_v2')).rows).toEqual([{ user_id: A }]);
    await asUser(B); expect((await db.query('SELECT * FROM public.paper_books_v2')).rows).toEqual([]);
    expect(await save(0)).toBe(true);
    expect((await db.query<{ user_id: string }>('SELECT user_id FROM public.paper_books_v2')).rows).toEqual([{ user_id: B }]);
  });
  it('rejects stale revisions atomically, without overwriting the current book', async () => {
    await asUser(A); expect(await save(1)).toBe(true); expect(await save(1)).toBe(false);
    const { rows } = await db.query<{ revision: number }>('SELECT revision FROM public.paper_books_v2');
    expect(Number(rows[0].revision)).toBe(2);
  });
  it('rejects direct writes and anonymous RPC access', async () => {
    await asUser(A);
    await expect(db.query('UPDATE public.paper_books_v2 SET revision = 999')).rejects.toThrow('permission denied');
    await asUser('', 'anon'); await expect(save(0)).rejects.toThrow('permission denied');
    await asUser(''); await expect(save(0)).rejects.toThrow('Authentication required');
  });
  it('rejects A’s late payload if the SDK has switched to B credentials before sending', async () => {
    await asUser(B); await expect(save(1, empty, A)).rejects.toThrow('Account changed');
    expect(Number((await db.query<{ revision: number }>('SELECT revision FROM public.paper_books_v2')).rows[0].revision)).toBe(1);
  });
  it('refuses to discard tombstones, including when visible history is empty', async () => {
    await asUser(B); expect(await save(1, { ...empty, closedPositionIds: ['closed-position'] as never[], deletedTradeIds: ['deleted-trade'] as never[] })).toBe(true);
    await expect(save(2)).rejects.toThrow('tombstones');
    expect(Number((await db.query<{ revision: number }>('SELECT revision FROM public.paper_books_v2')).rows[0].revision)).toBe(2);
  });
  it('enforces collection and document size constraints', async () => {
    await asUser(A);
    await expect(save(2, { ...empty, positions: Array(5001).fill({}) as never[] })).rejects.toThrow('Book limit');
    await expect(save(2, { ...empty, positions: [{ note: 'x'.repeat(2_100_000) }] as never[] })).rejects.toThrow('oversized');
    await expect(db.query('SELECT public.save_paper_book_v2($1::uuid, 2, $2::jsonb)', [A, JSON.stringify({ version: 2 })])).rejects.toThrow('Missing book collection');
  });
  it('freezes legacy writes at cutover without modifying their data', async () => {
    await db.exec('RESET ROLE; GRANT INSERT, UPDATE, DELETE ON public.positions, public.closed_trades TO authenticated;');
    await db.exec(await readFile(new URL('../../supabase/migrations/20260923_freeze_legacy_books.sql', import.meta.url), 'utf8'));
    await asUser(A); await expect(db.query("INSERT INTO positions VALUES ('unsafe-old-client', 1)")).rejects.toThrow('permission denied');
  });
  it('leaves legacy tables/profit fields untouched', async () => {
    await db.exec('RESET ROLE');
    expect((await db.query('SELECT * FROM positions')).rows).toEqual([{ id: 'legacy', profit: '123' }]);
    expect((await db.query('SELECT * FROM closed_trades')).rows).toEqual([{ id: 'legacy', profit: '456' }]);
  });
});
