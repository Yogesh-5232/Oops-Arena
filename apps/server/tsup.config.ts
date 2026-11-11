import { defineConfig } from 'tsup';

// Shared exports are TypeScript source; include them in the production bundle.
export default defineConfig({ noExternal: ['@chaos/shared'] });
