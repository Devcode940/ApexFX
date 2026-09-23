/**
 * Vercel entry point: one function fronts every /api/* route of the Express app.
 *
 * - The app is exported without starting services or listeners. Node startup is server/start.ts.
 * - `vite` is imported dynamically inside startServer() so the function bundle never needs it.
 * - req.url is canonicalised because the rewrite may deliver the original path, the destination,
 *   or the mount-relative remainder (see server/lib/vercel.ts).
 * - Vercel offers WebSockets in Beta, but this HTTP function/rewrite does not wire that transport.
 *   /api/capabilities advertises polling until routing, lifetimes and shared state are separately verified.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import app from '../server';
import { normalizeVercelUrl } from '../server/lib/vercel';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  req.url = normalizeVercelUrl(req);
  return app(req, res);
}
