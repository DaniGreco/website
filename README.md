# danielegreco.com

My personal site. The home page has an interactive model of the infrastructure I run: send a request
through it, switch servers off, ship a release, add a server.

Built with [Astro](https://astro.build), React (only for the map) and Tailwind CSS. The output is
static and Cloudflare serves it from the edge.

## Run it

Node 22.12 or newer.

```sh
npm install
npm run dev       # http://localhost:4321
npm run build     # static site in dist/
npm run preview   # serve dist/ locally
npm test          # unit tests (Vitest)
```

## Where things are

- `src/pages/index.astro`: the page.
- `src/components/Playground/`: the map.
  - `model.js`: zones, servers, services, and how they get scheduled when something breaks.
    Pure functions, tested in `model.test.js`.
  - `layouts.js`: coordinates of the wide map (desktop) and the tall one (phone).
  - `Playground.jsx`: drawing, animations and the scenarios.
- `src/scripts/backgrounds/flow.js`: the page background, strands following a noise flow field;
  the pointer pulls them into a vortex. `loop.js` holds the shared canvas loop, `noise.js` the noise.
- `public/_redirects`: short links (`/github`, `/linkedin`, `/hai-sim`).
- `public/robots.txt`: asks AI training crawlers to stay out.

## Deploy

Cloudflare Workers with static assets, configured in `wrangler.jsonc`. Cloudflare builds and deploys
every push to `main` (build command `npm run build`, deploy command `npx wrangler deploy`).

By hand: `npx wrangler login`, then `npm run deploy`.
