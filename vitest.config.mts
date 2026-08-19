import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Server-side tests: they boot Payload, hit SQLite and call the Vori
    // client. jsdom would also define `window`, tripping the guard that keeps
    // the API key off the client.
    environment: 'node',
    // The integration tests share one SQLite file; running their files in
    // parallel has several workers pushing schema and writing rows at once,
    // which SQLite answers with SQLITE_ERROR rather than by serialising.
    fileParallelism: false,
    include: ['tests/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
