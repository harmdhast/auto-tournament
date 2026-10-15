// Serves tests/fixtures/skins/skins.json as the skin catalogue (SKINS_JSON_URL).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.SKINS_FIXTURE_PORT || 3098);
const file = fileURLToPath(new URL('../tests/fixtures/skins/skins.json', import.meta.url));

const server = createServer(async (_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(await readFile(file));
});
server.on('error', (error) => {
  console.error(`skins fixture: cannot listen on :${port}: ${error.message}`);
  process.exit(1);
});
server.listen(port, () => console.log(`skins fixture on :${port}`));
