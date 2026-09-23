import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { EMPTY_DRAWINGS, type DrawingsState } from '../types/chart';
import { drawingStorageKey, parseDrawings } from '../utils/chart/drawingTools';

/** Load/save carry the same key; an old symbol's effect can never write under the new symbol. */
export function useScopedDrawings(symbol: string, owner: string | null) {
  const key = owner ? drawingStorageKey(symbol, owner) : null;
  const [state, setState] = useState<{ key: string | null; data: DrawingsState; error: string | null; writable: boolean }>({ key: null, data: EMPTY_DRAWINGS, error: null, writable: false });
  useEffect(() => {
    if (!key) { setState({ key, data: EMPTY_DRAWINGS, error: null, writable: false }); return; }
    try {
      const raw = localStorage.getItem(key);
      setState({ key, data: raw ? parseDrawings(JSON.parse(raw)) : EMPTY_DRAWINGS, error: null, writable: true });
    } catch {
      setState({ key, data: EMPTY_DRAWINGS, error: 'Invalid/unreadable drawings preserved in storage. Export the original before repair.', writable: false });
    }
  }, [key]);
  useEffect(() => {
    if (!key || state.key !== key || !state.writable) return;
    try { localStorage.setItem(key, JSON.stringify(state.data)); }
    catch { setState(s => ({ ...s, writable: false, error: 'Drawings could not be saved. Storage is blocked/full.' })); }
  }, [key, state]);
  const setDrawings = useCallback((action: SetStateAction<DrawingsState>) => {
    setState(s => s.key !== key || !s.writable ? s : { ...s, data: typeof action === 'function' ? action(s.data) : action });
  }, [key]);
  const importLegacyDrawings = useCallback(() => {
    const raw = localStorage.getItem(`forexinsight_drawings_${symbol}`);
    if (!raw) throw new Error('No legacy drawings for this symbol.');
    setDrawings(parseDrawings(JSON.parse(raw)));
  }, [symbol, setDrawings]);
  return { drawings: state.key === key ? state.data : EMPTY_DRAWINGS, setDrawings, drawingError: state.key === key ? state.error : null, importLegacyDrawings };
}
