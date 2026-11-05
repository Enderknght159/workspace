export interface ApiErrorPayload {
  code: string;
  message: string;
  action: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly code: string;
  readonly action: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.message);
    this.name = 'ApiError';
    this.code = payload.code;
    this.action = payload.action;
    this.status = status;
    this.details = payload.details;
  }
}

let elevationToken: string | null = sessionStorage.getItem('workspace.elevation');
let actorId = localStorage.getItem('workspace.actorId') ?? 'usr_local';

export function setActorId(id: string): void {
  actorId = id;
  localStorage.setItem('workspace.actorId', id);
}

export function getActorId(): string {
  return actorId;
}

export function setElevationToken(token: string | null): void {
  elevationToken = token;
  if (token) sessionStorage.setItem('workspace.elevation', token);
  else sessionStorage.removeItem('workspace.elevation');
}

export function getElevationToken(): string | null {
  return elevationToken;
}

export function bridge() {
  const info = window.workspace ?? installDevBridge();
  if (!info) throw new ApiError(
    {
      code: 'WS-0001',
      message: 'لم يتم العثور على جسر سطح المكتب.',
      action: 'شغّل التطبيق من Workspace.exe لا من المتصفح.',
    },
    500,
  );
  return info;
}

/** للتطوير فقط: يسمح بفتح الواجهة في متصفح مع توكن المحرّك في الرابط. */
function installDevBridge() {  const params = new URLSearchParams(window.location.search);
  const apiBase = params.get('api');
  const token = params.get('token');
  if (!apiBase || !token) return null;
  const dev = {
    apiBase,
    token,
    appVersion: 'dev',
    platform: 'web',
    arch: 'web',
    officeDir: '',
    isPackaged: false,
    chooseDirectory: async () => null,
    chooseFile: async () => null,
    openPath: async () => '',
    showItemInFolder: async () => undefined,
    quit: async () => undefined,
    hideWindow: async () => undefined,
    getStartup: async () => false,
    setStartup: async () => false,
    createPremiereProject: async () => ({ ok: false, message: 'غير متاح في المتصفح.' }),
    installPremiereBridge: async () => ({ ok: false, message: 'غير متاح في المتصفح.' }),
  };
  window.workspace = dev;
  return dev;
}

installDevBridge();

export async function api<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    signal?: AbortSignal;
    actorId?: string;
  } = {},
): Promise<T> {
  const info = bridge();
  const headers: Record<string, string> = {
    authorization: `Bearer ${info.token}`,
    'x-actor-id': options.actorId ?? actorId,
  };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (elevationToken) headers['x-elevation'] = elevationToken;

  const response = await fetch(`${info.apiBase}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (payload as { error?: ApiErrorPayload } | null)?.error;
    throw new ApiError(
      error ?? {
        code: 'WS-0001',
        message: `فشل الطلب (${response.status})`,
        action: 'أعد المحاولة.',
      },
      response.status,
    );
  }
  return (payload as { data: T }).data;
}

export function mediaUrl(path: string): string {
  const info = bridge();
  const separator = path.includes('?') ? '&' : '?';
  return `${info.apiBase}${path}${separator}token=${encodeURIComponent(info.token)}`;
}

export async function downloadDiagnostics(): Promise<void> {
  const info = bridge();
  const response = await fetch(`${info.apiBase}/api/diagnostics`, {
    headers: { authorization: `Bearer ${info.token}` },
  });
  if (!response.ok) throw new ApiError({ code: 'WS-0001', message: 'فشل إنشاء حزمة التشخيص', action: 'أعد المحاولة.' }, response.status);
  const text = await response.text();
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `workspace-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
