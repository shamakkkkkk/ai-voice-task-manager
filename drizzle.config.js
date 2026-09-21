import { defineConfig } from 'drizzle-kit';

// `npm run db:studio` opens a browser UI for the database; `npm run db:generate` writes SQL migrations to ./drizzle.
// For a remote Turso database use: dialect: 'turso', dbCredentials: { url, authToken }.
export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema.js',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL || 'file:./data/tasks.db' },
});
