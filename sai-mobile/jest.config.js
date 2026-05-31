module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/tests/setup.ts'],
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|expo(nent)?|expo-.*|@expo(nent)?|@expo/.*|nativewind|react-native-css-interop|@react-native-community)/)',
  ],
};
