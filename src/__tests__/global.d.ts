// Global type declarations for tests
declare global {
  var testUtils: {
    createMockTask: (overrides?: any) => any;
    createMockTracker: () => any;
    wait: (ms: number) => Promise<void>;
  };
}

export {};