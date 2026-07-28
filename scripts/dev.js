'use strict';

// Starts the Vite dev server, then launches Electron pointed at it.
// Avoids needing concurrently/wait-on as extra dependencies.

const { spawn } = require('child_process');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: 'vite.config.ts' });
  await server.listen();

  const url = (server.resolvedUrls && server.resolvedUrls.local[0]) || 'http://localhost:5173/';
  console.log(`[dev] vite ready at ${url}`);

  const electronBin = require('electron');
  // VS Code's integrated terminal sets ELECTRON_RUN_AS_NODE=1, which would make
  // electron.exe execute main.js as a plain Node script instead of booting the app.
  const env = { ...process.env, VITE_DEV_SERVER_URL: url };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronBin, ['.'], { stdio: 'inherit', env });

  const shutdown = async (code) => {
    try {
      await server.close();
    } catch {
      /* ignore */
    }
    process.exit(code ?? 0);
  };

  child.on('close', shutdown);
  process.on('SIGINT', () => {
    child.kill();
    shutdown(0);
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
