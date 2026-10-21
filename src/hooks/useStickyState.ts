import { useCallback, useEffect, useState, type SetStateAction } from "react";

// Remembers a page's filters while the user moves between screens (in memory),
// and across a refresh in the same browser tab (sessionStorage).
const mem = new Map<string, unknown>();
const storeKey = (k: string) => `sticky:${k}`;

export function useStickyState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => (mem.has(key) ? (mem.get(key) as T) : initial));

  // After a hard refresh, restore from sessionStorage once hydrated (avoids SSR mismatch).
  useEffect(() => {
    if (mem.has(key)) return;
    try {
      const raw = window.sessionStorage.getItem(storeKey(key));
      if (raw != null) {
        const parsed = JSON.parse(raw) as T;
        mem.set(key, parsed);
        setValue(parsed);
      }
    } catch {
      /* ignore bad or blocked storage */
    }
  }, [key]);

  const set = useCallback(
    (next: SetStateAction<T>) => {
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        mem.set(key, v);
        try {
          window.sessionStorage.setItem(storeKey(key), JSON.stringify(v));
        } catch {
          /* ignore */
        }
        return v;
      });
    },
    [key],
  );

  return [value, set] as const;
}
