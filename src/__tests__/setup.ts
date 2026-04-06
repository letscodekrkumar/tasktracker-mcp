// Test setup file
// This file runs before all tests

// Mock console methods to reduce noise during testing
global.console = {
  ...console,
  // Uncomment to silence logs during testing
  // log: jest.fn(),
  // error: jest.fn(),
  // warn: jest.fn(),
};

// Set up test environment variables
process.env.NODE_ENV = 'test';

// Add any global test utilities here
global.testUtils = {
  // Helper to create mock tasks
  createMockTask: (overrides = {}) => ({
    id: 'test-task-1',
    title: 'Test Task',
    category: 'general',
    priority: 'medium',
    status: 'pending',
    finding: null,
    finding_history: [],
    depends_on: [],
    unmet_deps: [],
    created: new Date().toISOString(),
    resolved_at: null,
    reopen_count: 0,
    ...overrides,
  }),

  // Helper to create mock tracker instances
  createMockTracker: () => ({
    tasks: new Map(),
    taskCounter: 0,
    sessionStartTime: new Date(),
  }),

  // Helper to wait for async operations
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
};
