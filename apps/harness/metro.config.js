// Metro config for the Expo harness.
//
// The harness imports the sample tree via the `@rn-canvas/document/sample`
// package-exports subpath (keeping the WASM Yoga mapping and Zustand store out
// of the native bundle). Metro on RN 0.76 doesn't honor the `exports` field by
// default, so enable it explicitly.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
