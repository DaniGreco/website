import { getContainerRenderer } from '@astrojs/react';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { beforeAll, describe, expect, it } from 'vitest';
import NotFound from '../pages/404.astro';
import Index from '../pages/index.astro';

let container;
beforeAll(async () => {
  // The home page holds the React map.
  const renderers = await loadRenderers([getContainerRenderer()]);
  container = await AstroContainer.create({ renderers, astroConfig: { site: 'https://danielegreco.com' } });
});
const render = (page, path) => container.renderToString(page, { request: new Request(`https://danielegreco.com${path}`) });

describe('the head of a page', () => {
  it('points the home page to its own address and its translation', async () => {
    const html = await render(Index, '/');
    expect(html).toContain('<link rel="canonical" href="https://danielegreco.com/">');
    expect(html).toContain('<meta property="og:url" content="https://danielegreco.com/">');
    expect(html).toContain('hreflang="it" href="https://danielegreco.com/it/"');
    expect(html).not.toContain('name="robots"');
  });

  it('keeps the not-found page out of search results, with no address of its own', async () => {
    const html = await render(NotFound, '/does-not-exist');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('og:url');
    expect(html).not.toContain('hreflang=');
  });
});
