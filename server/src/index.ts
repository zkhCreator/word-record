import { config } from './config.ts';
import { openDb } from './db.ts';
import { Repo } from './repo.ts';
import { magpieEnricher, magpieModels } from './magpie.ts';
import { createApp } from './app.ts';

const repo = new Repo(openDb(config.dbPath));
const folded = repo.aggregateByLemma();
if (folded) console.log(`merged ${folded} duplicate entr${folded === 1 ? 'y' : 'ies'} by lemma`);
const app = createApp(repo, { enrich: magpieEnricher, listModels: magpieModels }, { webDist: config.webDist });

app.listen(config.port, config.host, () => {
  console.log(`word-record server  http://${config.host}:${config.port}`);
  console.log(`  db     ${config.dbPath}`);
  console.log(`  models ${repo.getSetting('baseUrl') || config.magpie.baseUrl}  (${repo.getSetting('model') || config.magpie.model})`);
});
