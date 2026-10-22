"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Loads data from the API when `key` changes.
 * `data` is undefined while the first load runs; `reload()` fetches again and keeps the old data meanwhile.
 * `setData` lets a page show the server's reply to a save without fetching again.
 */
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ key: string; data?: T; error: string | null }>({ key, error: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => !cancelled && setState({ key, data, error: null }),
      (err: Error) => !cancelled && setState((s) => ({ ...s, key, error: err.message })),
    );
    return () => {
      cancelled = true;
    };
    // `load` is a new function each render; `key` says when to fetch again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback((data: T) => setState({ key, data, error: null }), [key]);
  const current = state.key === key;

  return { data: current ? state.data : undefined, error: current ? state.error : null, reload, setData };
}
