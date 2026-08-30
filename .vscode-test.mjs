import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/e2e/*.test.js',
  version: 'stable',
  mocha: { timeout: 20000 }
});
