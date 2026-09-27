import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { requireSupabaseClient } from '../lib/supabase';

/** Identity belongs above the book, not inside an optionally mounted sync panel. */
export function useAccountSession() {
  const [state, setState] = useState<{ ready: boolean; session: Session | null; error: string | null }>({
    ready: !requireSupabaseClient(), session: null, error: null,
  });
  useEffect(() => {
    const sb = requireSupabaseClient();
    if (!sb) return;
    let cancelled = false;
    let authEvents = 0;
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      authEvents++;
      if (!cancelled) setState({ ready: true, session, error: null });
    });
    const generation = authEvents;
    sb.auth.getSession().then(({ data, error }) => {
      if (cancelled || generation !== authEvents) return;
      setState({ ready: !error, session: data.session, error: error?.message ?? null });
    }).catch(() => {
      if (!cancelled && generation === authEvents) setState({ ready: false, session: null, error: 'Account initialization failed; reload to retry.' });
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);
  return { ...state, owner: state.ready ? (state.session ? `user:${state.session.user.id}` : 'guest') : null };
}
