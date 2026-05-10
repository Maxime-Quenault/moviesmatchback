import { buildApp } from './app.js';

const app = await buildApp();

try {
  await app.listen({
    host: app.config.APP_HOST,
    port: app.config.APP_PORT,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
