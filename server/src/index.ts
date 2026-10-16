import { config } from './config.ts';
import { openDb } from './db.ts';
import { Repo } from './repo.ts';
import { magpieEnricher, magpieModels } from './magpie.ts';
import { createApp } from './app.ts';

const repo = new Repo(openDb(config.dbPath));
const app = createApp(repo, { enrich: magpieEnricher, listModels: magpieModels }, { webDist: config.webDist });

app.listen(config.port, config.host, () => {
  console.log(`word-record server  http://${config.host}:${config.port}`);
  console.log(`  db     ${config.dbPath}`);
  console.log(`  magpie ${config.magpie.baseUrl}  (model: ${repo.getSetting('model') || config.magpie.model})`);
});
