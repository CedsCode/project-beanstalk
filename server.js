'use strict';

const { createApp, log, appVersion } = require('./src/app');
const metadata = require('./src/metadata');

// Beanstalk's nginx proxies to port 8080 by default; the PORT env property overrides it.
const port = Number(process.env.PORT) || 8080;
const server = createApp().listen(port, () => {
  log('info', 'server.start', { port, version: appVersion(), pid: process.pid, node: process.version });
});

metadata.get(); // warm the instance-metadata cache

// Beanstalk sends SIGTERM when it stops or restarts the app (deploys, config changes).
process.on('SIGTERM', () => {
  log('info', 'server.sigterm', { pid: process.pid, message: 'Shutting down gracefully' });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
