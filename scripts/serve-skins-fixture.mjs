// Serves tests/fixtures/skins/skins.json as the skin catalogue (SKINS_JSON_URL).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.SKINS_FIXTURE_PORT || 3098);
const file = fileURLToPath(new URL('../tests/fixtures/skins/skins.json', import.meta.url));

createServer(async (_req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(await readFile(file));
}).listen(port, () => console.log(`skins fixture on :${port}`));
