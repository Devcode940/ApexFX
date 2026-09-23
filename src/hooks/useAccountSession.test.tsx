// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, deferred } from '../test/harness';
import { useAccountSession } from './useAccountSession';
import type { Session } from '@supabase/supabase-js';
const auth = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('../lib/supabase', () => ({ requireSupabaseClient: () => ({ auth }) }));
afterEach(() => vi.clearAllMocks());
it('late initial session cannot replace an intervening sign-in/logout event', async () => {
  const wait = deferred<{ data: { session: Session | null }; error: null }>();
  let listener!: (_event: string, session: Session | null) => void;
  const unsubscribe = vi.fn();
  auth.getSession.mockReturnValue(wait.promise); auth.onAuthStateChange.mockImplementation(callback => { listener = callback; return { data: { subscription: { unsubscribe } } }; });
  const hook = await renderHook(useAccountSession, undefined);
  expect(hook.result.ready).toBe(false);
  const a = { user: { id: 'A' } } as Session; const b = { user: { id: 'B' } } as Session;
  act(() => listener('SIGNED_IN', b));
  await act(async () => wait.resolve({ data: { session: a }, error: null }));
  expect(hook.result.owner).toBe('user:B');
  act(() => listener('SIGNED_OUT', null)); expect(hook.result.owner).toBe('guest');
  await hook.unmount(); expect(unsubscribe).toHaveBeenCalled();
});
describe('initial session errors', () => {
  it('fails closed to account readiness rather than exposing an arbitrary guest/book identity', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('unavailable') });
    auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    const hook = await renderHook(useAccountSession, undefined);
    expect(hook.result.owner).toBeNull(); expect(hook.result.ready).toBe(false); expect(hook.result.error).toBe('unavailable');
    await hook.unmount();
  });
});
