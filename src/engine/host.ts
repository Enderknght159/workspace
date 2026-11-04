import { join } from 'node:path';
import { Office } from './office/office.js';
import { startHttpServer } from './http/server.js';
import { randomToken } from './util/misc.js';
import { APP_VERSION } from '../shared/constants.js';

interface Options {
  office: string;
  port: number;
  token: string;
  queue: boolean;
}

function readOptions(argv: string[]): Options {
  let office = process.env.WORKSPACE_OFFICE ?? join(process.cwd(), 'WorkspaceOffice');
  let port = 0;
  let queue = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--office') {
      office = argv[index + 1] ?? office;
      index += 1;
    } else if (arg === '--port') {
      port = Number(argv[index + 1] ?? '0') || 0;
      index += 1;
    } else if (arg === '--no-queue') {
      queue = false;
    }
  }
  return {
    office,
    port,
    token: process.env.WORKSPACE_ENGINE_TOKEN ?? randomToken(32),
    queue,
  };
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const office = Office.open({ dir: options.office });
  if (options.queue) office.queue.start();

  const http = await startHttpServer({
    office,
    token: options.token,
    port: options.port,
  });

  const handshake = {
    type: 'engine.ready',
    version: APP_VERSION,
    port: http.port,
    token: options.token,
    pid: process.pid,
    officeId: office.config.id,
  };
  process.stdout.write(`${JSON.stringify(handshake)}\n`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    office.logger.info('engine.shutdown', { signal });
    try {
      await office.queue.stop();
      await http.close();
    } finally {
      office.close();
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    office.logger.error('engine.uncaught', { error: String(error) });
  });
  process.on('unhandledRejection', (reason) => {
    office.logger.error('engine.unhandled_rejection', { error: String(reason) });
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ type: 'engine.error', message })}\n`);
  process.exit(1);
});
