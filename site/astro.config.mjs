import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import icon from 'astro-icon';

export default defineConfig({
  site: 'https://darkharasho.github.io',
  base: '/sai/',
  trailingSlash: 'ignore',
  integrations: [sitemap(), icon()],
});
