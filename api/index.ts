/**
 * Vercel entry point: one function fronts every /api/* route of the Express app.
 *
 * - The app is exported by server.ts WITHOUT binding a socket there (startServer() is skipped when
 *   process.env.VERCEL is set), so importing it here must not start a listener.
 * - `vite` is imported dynamically inside startServer() so the function bundle never needs it.
 * - req.url is canonicalised because the rewrite may deliver the original path, the destination,
 *   or the mount-relative remainder (see server/lib/vercel.ts).
 * - WebSockets are not available on Vercel's function runtime; the client's feed therefore settles
 *   into POLL mode (with backoff) against /api/market/prices, which is a supported state.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import app from '../server';
import { normalizeVercelUrl } from '../server/lib/vercel';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  req.url = normalizeVercelUrl(req);
  return app(req, res);
}
