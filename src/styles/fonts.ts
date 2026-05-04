// Vite resolves .woff2 imports as asset URLs by default
const geistSansUrl = new URL('../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2', import.meta.url).href;
const geistMonoUrl = new URL('../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2', import.meta.url).href;
const departureMonoUrl = new URL('../../public/fonts/DepartureMono-Regular.woff2', import.meta.url).href;

const css = `
@font-face {
  font-family: 'Geist';
  src: url('${geistSansUrl}') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Geist Mono';
  src: url('${geistMonoUrl}') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Departure Mono';
  src: url('${departureMonoUrl}') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
`;

const style = document.createElement('style');
style.textContent = css;
document.head.prepend(style);
