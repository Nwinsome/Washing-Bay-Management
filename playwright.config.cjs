const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './desktop-tests', testMatch: '*.spec.cjs', workers: 1,
  timeout: 120000, expect: { timeout: 15000 },
  outputDir: 'desktop-test-results', reporter: [['list']],
});
