// Downloads the live JSON Schema from the Agent Builder API and brings every copy of it up to date: the test fixture, the public
// download (public/config) and the generated TypeScript declarations (see schemaCopies.mjs). Run it with `npm run sync-fixtures`
// (reads AGENT_BUILDER_URL and AGENT_BUILDER_API_KEY from the environment or from .env.local). `npm run build` then refreshes dist/.
import { fetchSchema } from './apiSchema.mjs';
import { writeCopies } from './schemaCopies.mjs';

const schema = await fetchSchema();
const written = writeCopies(schema);
console.log(`Synced the schema (${Object.keys(schema.properties || {}).length} top-level sections) to:`);
written.forEach((file) => console.log(`  ${file}`));
