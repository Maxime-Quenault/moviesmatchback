import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';

let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
  appPromise ??= buildApp();

  const app = await appPromise;
  await app.ready();

  return app;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const app = await getApp();
  app.server.emit('request', request, response);
}
