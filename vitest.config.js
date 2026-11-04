import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // React's test helpers (act) exist only outside production builds, whatever the shell sets.
    env: { NODE_ENV: 'test' },
  },
});
