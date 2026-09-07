import { buildApp } from './app.js';
import { config } from './config.js';
import { createServices } from './services.js';

const services = await createServices();
const app = await buildApp(services);

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { version: config.buildInfo.version, changelogDir: config.changelogDir },
    'RepoLens API พร้อมใช้งาน',
  );
} catch (error) {
  app.log.error({ err: error }, 'เริ่ม API ไม่สำเร็จ');
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await services.close();
      process.exit(0);
    })();
  });
}
