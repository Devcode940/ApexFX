import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function renderHook<T, P>(hook: (props: P) => T, props: NoInfer<P>, strict = false) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  let result!: T;
  function Harness(p: { value: P }) { result = hook(p.value); return null; }
  const rerender = async (value: P) => {
    await act(async () => root.render(strict ? <StrictMode><Harness value={value} /></StrictMode> : <Harness value={value} />));
  };
  await rerender(props);
  return { get result() { return result; }, rerender, container,
    async unmount() { await act(async () => root.unmount()); container.remove(); } };
}
