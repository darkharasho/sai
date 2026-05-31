module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEach: ['<rootDir>/tests/setup.ts'],
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|expo(nent)?|@expo(nent)?|nativewind|react-native-css-interop|@react-native-community)/)',
  ],
};
