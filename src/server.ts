import { buildApp } from './app.js';

const app = await buildApp();

try {
  await app.listen({
    host: app.config.HOST,
    port: app.config.PORT,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
