import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api.js';
import { useApp } from './app-context.js';

export interface ApiState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload(): void;
}

/**
 * جلب مع تحديث دوري آمن. البث SSE يسرّع التحديث، لكنه ليس شرطًا لصحته:
 * إن انقطع البث يبقى كل شيء محدثًا خلال ثوانٍ.
 */
export function useApi<T>(path: string | null, pollMs = 6000): ApiState<T> {
  const { refreshKey } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const [localKey, setLocalKey] = useState(0);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let alive = true;
    let busy = false;

    const load = async (): Promise<void> => {
      if (!alive || busy) return;
      busy = true;
      try {
        const result = await api<T>(path);
        if (!alive) return;
        setData(result);
        setError(null);
      } catch (caught) {
        if (!alive) return;
        setError(caught instanceof ApiError ? caught : null);
      } finally {
        busy = false;
        if (alive) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, Math.max(1500, pollMs));

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [path, refreshKey, localKey, pollMs]);

  const reload = useCallback(() => setLocalKey((key) => key + 1), []);
  return { data, error, loading, reload };
}

export function useHashRoute(): string {
  const read = (): string => {
    const hash = window.location.hash.replace(/^#/, '');
    return hash.length > 0 ? hash : '/dashboard';
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = (): void => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path: string): void {
  window.location.hash = `#${path}`;
}

export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
