import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { extname } from 'node:path';
import type { AddressInfo } from 'node:net';
import { z, type ZodType } from 'zod';
import { APP_VERSION } from '../../shared/constants.js';
import { AppError } from '../../shared/errors.js';
import type { JobState } from '../../shared/state-machines.js';
import {
  archiveRunRequest,
  createEventRequest,
  createJobRequest,
  elevateRequest,
  eventIdParams,
  ingestPreviewRequest,
  jobFilterQuery,
  jobIdParams,
  listQuery,
  publishJobRequest,
  registerVolumeRequest,
  reviewJobRequest,
  setElevationPasswordRequest,
  settingsPatchRequest,
  transitionEventRequest,
  updateEventRequest,
} from '../../shared/schemas.js';
import type { Office } from '../office/office.js';
import { safeOutputName } from '../agent/mock-agent.js';

export interface HttpServerOptions {
  office: Office;
  token: string;
  port?: number;
  host?: string;
}

export interface EngineHttpServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

type Handler = (context: RequestContext) => Promise<unknown> | unknown;

interface RequestContext {
  office: Office;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  actorId: string | null;
  elevationToken: string | null;
}

interface Route {
  method: string;
  path: string;
  regex: RegExp;
  keys: string[];
  allowQueryToken?: boolean;
  handler: Handler;
}

export async function startHttpServer(options: HttpServerOptions): Promise<EngineHttpServer> {
  const { office, token } = options;
  const startedAt = Date.now();
  const routes = buildRoutes();

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error: unknown) => {
      const appError = AppError.from(error);
      office.logger.warn('http.error', {
        path: req.url,
        code: appError.code,
        message: appError.message,
      });
      if (!res.headersSent) sendJson(res, appError.status, { error: appError.toJSON() });
      else res.destroy();
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? options.host ?? '127.0.0.1'}`);
    applyCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const route = matchRoute(routes, req.method ?? 'GET', url.pathname);
    if (!route) {
      sendJson(res, 404, { error: new AppError('WS-0002', { path: url.pathname }).toJSON() });
      return;
    }

    const authorization = req.headers.authorization;
    const bearer =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : null;
    const queryToken = route.allowQueryToken ? url.searchParams.get('token') : null;
    if (!secureEqual(bearer ?? queryToken ?? '', token)) {
      throw new AppError('WS-0004');
    }

    const elevationHeader = req.headers['x-elevation'];
    const elevationToken = typeof elevationHeader === 'string' && elevationHeader.length > 0 ? elevationHeader : null;
    const actorHeader = req.headers['x-actor-id'];
    const actorId = typeof actorHeader === 'string' && actorHeader.length > 0 ? actorHeader : 'usr_local';

    if (route.path === '/api/stream') {
      streamEvents(req, res, office);
      return;
    }

    const params = extractParams(route, url.pathname);
    const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await readJsonBody(req);
    const result = await route.handler({
      office,
      req,
      res,
      url,
      params,
      body,
      actorId,
      elevationToken,
    });
    if (!res.headersSent) {
      sendJson(res, 200, { data: result ?? null });
    }
  }

  server.listen(options.port ?? 0, options.host ?? '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  return {
    server,
    port: address.port,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function buildRoutes(): Route[] {
  return [
    route('GET', '/health', ({ office }) => ({ ok: true, version: APP_VERSION, office: office.config.id })),
    route('GET', '/api/info', ({ office }) => ({
      version: APP_VERSION,
      office: {
        id: office.config.id,
        name: office.config.name,
        dir: office.config.id ? office.paths.root : '',
        schema: office.config.schema,
      },
      queue: office.jobs.stats(),
      uptimeSeconds: Math.round(process.uptime()),
    })),

    route('GET', '/api/events', ({ office, url }) => {
      const query = parseQuery(listQuery, url);
      return office.events.list(query);
    }),
    route('POST', '/api/events', ({ office, body, actorId }) =>
      office.events.create(parseBody(createEventRequest, body), actorId),
    ),
    route('GET', '/api/events/:id', ({ office, params }) =>
      office.events.get(parseParams(eventIdParams, params).id),
    ),
    route('PATCH', '/api/events/:id', ({ office, params, body, actorId }) =>
      office.events.update(parseParams(eventIdParams, params).id, parseBody(updateEventRequest, body), actorId),
    ),
    route('POST', '/api/events/:id/transition', ({ office, params, body, actorId, elevationToken }) => {
      const request = parseBody(transitionEventRequest, body);
      if (['published', 'archived', 'cold'].includes(request.to)) {
        office.security.requireElevation(elevationToken);
      }
      return office.events.transition(parseParams(eventIdParams, params).id, request.to, {
        actorId,
        reason: request.reason,
        elevated: office.security.isElevated(elevationToken),
      });
    }),

    route('GET', '/api/jobs', ({ office, url }) => {
      const parsed = parseQuery(jobFilterQuery, url);
      return office.jobs.list({
        state: parsed.state as JobState | undefined,
        eventId: parsed.eventId,
        limit: parsed.limit,
      });
    }),
    route('POST', '/api/jobs', ({ office, body, actorId }) =>
      office.jobs.create(parseBody(createJobRequest, body), actorId),
    ),
    route('GET', '/api/jobs/:id', ({ office, params }) =>
      office.jobs.get(parseParams(jobIdParams, params).id),
    ),
    route('POST', '/api/jobs/:id/cancel', ({ office, params }) =>
      office.jobs.cancel(parseParams(jobIdParams, params).id),
    ),
    route('POST', '/api/jobs/:id/retry', ({ office, params }) =>
      office.jobs.retry(parseParams(jobIdParams, params).id),
    ),
    route('POST', '/api/jobs/:id/review', ({ office, params, body, actorId, elevationToken }) => {
      const request = parseBody(reviewJobRequest, body);
      if (request.decision === 'approved') office.security.requireElevation(elevationToken);
      return office.jobs.review(parseParams(jobIdParams, params).id, request, actorId);
    }),
    route('POST', '/api/jobs/:id/publish', ({ office, params, body, actorId, elevationToken }) => {
      office.security.requireElevation(elevationToken);
      return office.jobs.publish(parseParams(jobIdParams, params).id, parseBody(publishJobRequest, body), actorId);
    }),
    route('GET', '/api/review/pending', ({ office }) => office.jobs.list({ state: 'review_pending', limit: 200 })),

    route('GET', '/api/volumes', ({ office }) => office.volumes.list()),
    route('POST', '/api/volumes/register', ({ office, body, actorId, elevationToken }) => {
      office.security.requireElevation(elevationToken);
      const request = parseBody(registerVolumeRequest, body);
      return office.volumes.register(request, actorId, office.config.id);
    }),
    route('POST', '/api/volumes/scan', ({ office }) => office.volumes.scan()),

    route('GET', '/api/styles', ({ office }) => office.styles.list()),
    route('POST', '/api/styles/reload', ({ office, elevationToken }) => {
      office.security.requireElevation(elevationToken);
      return office.styles.reload();
    }),

    route('POST', '/api/ingest/preview', async ({ office, body }) =>
      office.ingest.preview(parseBody(ingestPreviewRequest, body)),
    ),
    route('POST', '/api/ingest/start', async ({ office, body, actorId }) =>
      office.ingest.start(parseBody(ingestPreviewRequest, body), actorId),
    ),
    route('GET', '/api/ingest/batches', ({ office }) => office.ingest.listBatches(50)),
    route('POST', '/api/ingest/:id/cancel', ({ office, params }) =>
      office.ingest.cancel(parseParams(jobIdParams, params).id),
    ),

    route('GET', '/api/doctor', ({ office }) => office.doctor.last()),
    route('POST', '/api/doctor/run', async ({ office, body }) => {
      const parsed = z.object({ deep: z.boolean().optional() }).safeParse(body ?? {});
      return office.doctor.run({ deep: parsed.success ? parsed.data.deep : false });
    }),

    route('GET', '/api/audit', ({ office, url }) => {
      const limit = Number(url.searchParams.get('limit') ?? '100');
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const entity = url.searchParams.get('entity') ?? undefined;
      return office.audit.list({
        limit: Number.isFinite(limit) ? Math.min(500, Math.max(1, limit)) : 100,
        offset: Number.isFinite(offset) ? Math.max(0, offset) : 0,
        entity,
      });
    }),

    route('GET', '/api/settings', ({ office }) => publicSettings(office)),
    route('PATCH', '/api/settings', ({ office, body, actorId, elevationToken }) => {
      office.security.requireElevation(elevationToken);
      const patch = parseBody(settingsPatchRequest, body);
      const updated = office.settings.update(patch, actorId);
      if (patch.office?.name) office.rename(patch.office.name);
      return publicSettings(office);
    }),

    route('GET', '/api/security/status', ({ office, elevationToken }) => office.security.status(elevationToken)),
    route('POST', '/api/security/password', ({ office, body, actorId, elevationToken }) => {
      if (office.security.hasPassword()) office.security.requireElevation(elevationToken);
      return office.security.setPassword(parseBody(setElevationPasswordRequest, body).password, actorId);
    }),
    route('POST', '/api/elevate', ({ office, body, actorId }) =>
      office.security.elevate(parseBody(elevateRequest, body).password, actorId),
    ),

    route('GET', '/api/assets/:id/file', ({ office, params, res }) => {
      const asset = office.db.get<{
        volume_id: string;
        rel_path: string;
        kind: string;
      }>('SELECT volume_id, rel_path, kind FROM assets WHERE id = ?', params.id ?? '');
      if (!asset) throw new AppError('WS-0002', { assetId: params.id });
      const volume = office.volumes.get(asset.volume_id);
      if (!volume?.root) throw new AppError('WS-2002', { volumeId: asset.volume_id });
      const file = office.paths.resolveInside(volume.root, asset.rel_path);
      streamFile(res, file);
      return undefined;
    }, true),
    route('GET', '/api/jobs/:id/files/:name', ({ office, params, res }) => {
      const built = office.jobs.buildJobFile(params.id ?? '');
      const name = safeOutputName(params.name ?? '');
      const file = office.paths.resolveInside(built.outputDir, name);
      streamFile(res, file);
      return undefined;
    }, true),

    route('GET', '/api/diagnostics', ({ office }) => ({
      generatedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      office: { id: office.config.id, name: office.config.name, schema: office.config.schema },
      machineId: office.machineId,
      settings: publicSettings(office),
      doctor: office.doctor.last(),
      counts: office.jobs.stats(),
      logs: office.logger.recent(300),
    })),
    route('POST', '/api/backup', ({ office, elevationToken }) => {
      office.security.requireElevation(elevationToken);
      return office.backup();
    }),
    route('GET', '/api/backups', ({ office }) => office.listBackups()),

    route('GET', '/api/archive/candidates', ({ office }) => office.archive.candidates()),
    route('POST', '/api/archive/run', async ({ office, body, actorId, elevationToken }) => {
      office.security.requireElevation(elevationToken);
      const request = parseBody(archiveRunRequest, body);
      return office.archive.run({ ...request, actorId });
    }),
    route('POST', '/api/archive/purge', ({ office, elevationToken }) => {
      office.security.requireElevation(elevationToken);
      return office.archive.purgeTrash();
    }),

    route('GET', '/api/stream', () => undefined, true),
  ];
}

function route(method: string, path: string, handler: Handler, allowQueryToken = false): Route {
  const keys: string[] = [];
  const pattern = path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { method, path, regex: new RegExp(`^${pattern}/?$`), keys, allowQueryToken, handler };
}

function matchRoute(routes: Route[], method: string, path: string): Route | undefined {
  return routes.find((candidate) => candidate.method === method && candidate.regex.test(path));
}

function extractParams(route: Route, path: string): Record<string, string> {
  const match = route.regex.exec(path);
  if (!match) return {};
  const params: Record<string, string> = {};
  route.keys.forEach((key, index) => {
    params[key] = decodeURIComponent(match[index + 1] ?? '');
  });
  return params;
}

function parseBody<T>(schema: ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('WS-0003', {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return parsed.data;
}

function parseParams<T>(schema: ZodType<T>, params: Record<string, string>): T {
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new AppError('WS-0003', { issues: parsed.error.issues });
  return parsed.data;
}

function parseQuery<T>(schema: ZodType<T>, url: URL): T {
  const raw: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (value.length > 0) raw[key] = value;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('WS-0003', {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return parsed.data;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 2 * 1024 * 1024) throw new AppError('WS-0003', { reason: 'body_too_large' });
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('WS-0003', { reason: 'invalid_json' });
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  const allowed =
    origin === undefined ||
    origin === 'null' ||
    /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
  if (origin && allowed) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'access-control-allow-headers',
    'authorization,content-type,x-actor-id,x-elevation',
  );
  res.setHeader('access-control-max-age', '600');
}

function secureEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

function streamEvents(req: IncomingMessage, res: ServerResponse, office: Office): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'access-control-allow-origin': req.headers.origin ?? '*',
  });
  res.write(
    `event: hello\ndata: ${JSON.stringify({
      type: 'hello',
      seq: office.bus.currentSeq,
      at: new Date().toISOString(),
      version: APP_VERSION,
    })}\n\n`,
  );
  const unsubscribe = office.bus.subscribe((event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25_000);
  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

function publicSettings(office: Office): Record<string, unknown> {
  const settings = office.settings.get();
  return {
    ...settings,
    security: {
      hasPassword: office.security.hasPassword(),
      idleLockMinutes: settings.security.idleLockMinutes,
    },
  };
}

function streamFile(res: ServerResponse, file: string): void {
  if (!existsSync(file)) throw new AppError('WS-0002', { file: 'media' });
  const stats = statSync(file);
  const range = res.req.headers.range;
  const contentType = mimeFor(file);
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1;
    if (start >= stats.size || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${stats.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'content-type': contentType,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${stats.size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=300',
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': stats.size,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=300',
  });
  createReadStream(file).pipe(res);
}

function mimeFor(file: string): string {
  switch (extname(file).toLowerCase()) {
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.webm':
      return 'video/webm';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.m4a':
      return 'audio/mp4';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}
