const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// highlight.js 11.x ships its subpath modules (`lib/core`, `lib/languages/*`)
// through the package.json `exports` field. Metro doesn't honor `exports`
// by default; without this flag the subpath imports in lib/highlight.ts
// resolve to "Unable to resolve" even though the .js files exist on disk.
config.resolver.unstable_enablePackageExports = true;

module.exports = withNativeWind(config, { input: './global.css' });
