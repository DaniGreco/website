import { getViteConfig } from 'astro/config';

// Astro's Vite setup, so tests can render .astro components with the container API.
export default getViteConfig({
  test: {
    // React's test helpers (act) exist only outside production builds, whatever the shell sets.
    env: { NODE_ENV: 'test' },
  },
});
