import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api, setElevationToken } from './api.js';
import { connectEvents } from './sse.js';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ElevationResponse {
  token: string;
  expiresAt: string | null;
}

interface AppContextValue {
  refreshKey: number;
  poke(): void;
  toasts: ToastItem[];
  toast(message: string, kind?: ToastKind): void;
  dismissToast(id: number): void;
  theme: 'dark' | 'light';
  setTheme(theme: 'dark' | 'light'): void;
  runElevated<T>(action: () => Promise<T>): Promise<T>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [theme, setThemeState] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('workspace.theme') as 'dark' | 'light' | null) ?? 'dark',
  );
  const [elevationOpen, setElevationOpen] = useState(false);
  const [elevationBusy, setElevationBusy] = useState(false);
  const [elevationError, setElevationError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const elevationResolver = useRef<((value: boolean) => void) | null>(null);
  const pokeTimer = useRef<number | null>(null);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 6000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const poke = useCallback(() => {
    if (pokeTimer.current !== null) return;
    pokeTimer.current = window.setTimeout(() => {
      pokeTimer.current = null;
      setRefreshKey((key) => key + 1);
    }, 250);
  }, []);

  useEffect(() => {
    const unsubscribe = connectEvents((event) => {
      if (event.type === 'log') return;
      poke();
    });
    return unsubscribe;
  }, [poke]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('workspace.theme', theme);
  }, [theme]);

  const setTheme = useCallback((next: 'dark' | 'light') => setThemeState(next), []);

  const requestElevation = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      elevationResolver.current = resolve;
      setPassword('');
      setElevationError(null);
      setElevationOpen(true);
    });
  }, []);

  const closeElevation = useCallback((result: boolean) => {
    setElevationOpen(false);
    setElevationBusy(false);
    elevationResolver.current?.(result);
    elevationResolver.current = null;
  }, []);

  const submitElevation = useCallback(async () => {
    setElevationBusy(true);
    setElevationError(null);
    try {
      const result = await api<ElevationResponse>('/api/elevate', {
        method: 'POST',
        body: { password },
      });
      setElevationToken(result.token);
      closeElevation(true);
      toast('فُتحت الصلاحية المرتفعة لعشر دقائق.', 'success');
    } catch (error) {
      setElevationError(error instanceof ApiError ? `${error.message} ${error.action}` : 'تعذّر التحقق.');
      setElevationBusy(false);
    }
  }, [password, closeElevation, toast]);

  const runElevated = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        if (error instanceof ApiError && error.code === 'WS-8001') {
          const unlocked = await requestElevation();
          if (!unlocked) throw error;
          return action();
        }
        throw error;
      }
    },
    [requestElevation],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      refreshKey,
      poke,
      toasts,
      toast,
      dismissToast,
      theme,
      setTheme,
      runElevated,
    }),
    [refreshKey, poke, toasts, toast, dismissToast, theme, setTheme, runElevated],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`toast toast--${item.kind}`}
            onClick={() => dismissToast(item.id)}
          >
            {item.message}
          </button>
        ))}
      </div>
      {elevationOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal modal--sm" role="dialog" aria-modal="true" aria-label="كلمة مرور المكتب">
            <div className="modal__head">
              <h2>كلمة مرور المكتب</h2>
            </div>
            <div className="modal__body">
              <p className="muted small">
                هذا الإجراء يحتاج صلاحية مرتفعة. تُفتح الصلاحية لمدة عشر دقائق، ويُسجَّل كل استخدام.
              </p>
              <label className="field">
                <span>كلمة المرور</span>
                <input
                  autoFocus
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && password.length > 0) void submitElevation();
                  }}
                />
              </label>
              {elevationError && <p className="form-error">{elevationError}</p>}
            </div>
            <div className="modal__foot">
              <button type="button" className="btn btn--ghost" onClick={() => closeElevation(false)}>
                إلغاء
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={elevationBusy || password.length === 0}
                onClick={() => void submitElevation()}
              >
                {elevationBusy ? 'جارٍ التحقق…' : 'فتح الصلاحية'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}
