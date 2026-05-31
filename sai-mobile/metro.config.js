const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// PWA bundle assets — Metro doesn't treat these as assets by default. Adding
// them here lets `require('../assets/pwa/inlined.html')` resolve at runtime
// so the per-machine WebView can read the file's contents via expo-asset.
config.resolver.assetExts.push('html', 'css', 'woff2', 'woff', 'ttf', 'otf');

module.exports = withNativeWind(config, { input: './global.css' });
