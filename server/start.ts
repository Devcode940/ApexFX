import { startServer, stopServer } from '../server';
import { error as logError } from './lib/logger';

void startServer().catch(error => { logError('[Server] Startup failed:', error); process.exitCode = 1; });
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    const force = setTimeout(() => process.exit(1), 10_000); force.unref();
    void stopServer().then(() => { clearTimeout(force); process.exit(0); }).catch(() => process.exit(1));
  });
}
