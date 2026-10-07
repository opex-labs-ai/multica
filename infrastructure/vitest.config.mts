import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The first CDK synth in a worker takes several seconds on a cold CI
    // runner — more than vitest's 5s default. That failed whichever test
    // happened to synthesize first, regardless of what it asserted.
    testTimeout: 30_000,
  },
});
