import { defineConfig } from 'vitest/config';

// Runs the one-off scripts in scripts/ (for example `npm run seed`) with the
// project's TypeScript setup. They are not part of `npm test`.
export default defineConfig({ test: { environment: 'node', include: ['scripts/**/*.ts'] } });
