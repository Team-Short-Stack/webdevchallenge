import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const { app, registry } = await buildApp(config);

const sweeper = setInterval(() => registry.sweep(), 5 * 60_000);
sweeper.unref();

const shutdown = async () => {
  clearInterval(sweeper);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(
  {
    model: config.realtimeModel,
    publicBaseUrl: config.publicBaseUrl ?? '(not set: the QR code will point at localhost)',
    twilioSignatureChecks: Boolean(config.twilioAuthToken),
    allowedCallers: config.allowedCallers.length || 'anyone',
    maxCallMinutes: config.maxCallMinutes,
    maxConcurrentCalls: config.maxConcurrentCalls,
  },
  'help desk is open',
);
