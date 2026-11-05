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
npm test          # tests (Vitest)
```

Tests sit next to the code they test (`*.test.js`). Pure logic runs in Node; tests that need a page
(the map, the wheel, the background loop) run in jsdom, and `src/layouts/Base.test.js` renders whole
pages with Astro's container API.

Every pull request runs the tests and the build on GitHub Actions (`.github/workflows/check.yml`).

## Where things are

- `src/pages/index.astro`: the page.
- `src/components/Playground/`: the map.
  - `model.js`: zones, servers, services, and how they get scheduled when something breaks.
  - `lines.js`: which log line to write when it depends on the state (a server going down,
    the end of a release). The texts are in `strings.js`, in English and Italian.
  - `focus.js`: the keyboard order of the map, which is a single tab stop moved with the arrow keys.
  - `layouts.js`: coordinates of the wide map (desktop) and the tall one (phone).
  - `Playground.jsx`: drawing, animations and the scenarios.
- `src/scripts/backgrounds/flow.js`: the page background, strands following a noise flow field;
  the pointer pulls them into a vortex. `loop.js` holds the shared canvas loop, `noise.js` the noise.
- `src/scripts/wheel.js`: on desktop one wheel tick steps between the first screen and the demo;
  over a box that can still scroll, such as the demo log, the wheel scrolls the box.
- `public/_redirects`: short links (`/github`, `/linkedin`, `/hai-sim`).
- `public/robots.txt`: asks AI training crawlers to stay out.

## Deploy

Cloudflare Workers with static assets, configured in `wrangler.jsonc`. Cloudflare builds and deploys
every push to `main` (build command `npm run build`, deploy command `npx wrangler deploy`).

By hand: `npx wrangler login`, then `npm run deploy`.
