import { TestingModule } from "@nestjs/testing";

/**
 * Helper functions for common test operations
 */
export class TestHelpers {
  /**
   * Wait for a specified amount of time
   */
  static async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for a condition to be true
   */
  static async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return;
      }
      await this.wait(interval);
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  }

  /**
   * Create a promise that can be resolved externally
   */
  static createDeferredPromise<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
  } {
    let resolve: (value: T) => void;
    let reject: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve: resolve!, reject: reject! };
  }

  /**
   * Get a service from a testing module with proper typing
   */
  static getService<T>(module: TestingModule, token: Parameters<TestingModule["get"]>[0]): T {
    return module.get<T>(token);
  }

  /**
   * Get a mocked service from a testing module
   */
  static getMockedService<T>(module: TestingModule, token: Parameters<TestingModule["get"]>[0]): jest.Mocked<T> {
    return module.get(token) as jest.Mocked<T>;
  }

  /**
   * Create a spy on a method and return the spy
   */
  static spyOn(object: unknown, method: string): jest.SpyInstance {
    // Internal cast to support spying on prototypes and arbitrary objects in tests
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (jest.spyOn as any)(object as Record<string, unknown>, method);
  }

  /**
   * Assert that a function throws an error with a specific message
   */
  static async expectToThrow(fn: () => Promise<unknown> | unknown, expectedMessage?: string | RegExp): Promise<void> {
    try {
      await fn();
      throw new Error("Expected function to throw, but it didn't");
    } catch (error) {
      if (expectedMessage) {
        const errorMessage = (error as Error).message;
        if (typeof expectedMessage === "string") {
          expect(errorMessage).toContain(expectedMessage);
        } else {
          expect(errorMessage).toMatch(expectedMessage);
        }
      }
    }
  }

  /**
   * Create a mock function that tracks call order
   */
  static createOrderedMock(): {
    mock: jest.Mock;
    getCallOrder: () => number[];
  } {
    let callOrder: number[] = [];
    let callCount = 0;

    const mock = jest.fn().mockImplementation(() => {
      callOrder.push(++callCount);
    });

    return {
      mock,
      getCallOrder: () => [...callOrder],
    };
  }

  /**
   * Generate random test data
   */
  static generateRandomString(length: number = 10): string {
    return Math.random()
      .toString(36)
      .substring(2, 2 + length);
  }

  static generateRandomNumber(min: number = 0, max: number = 100): number {
    return Math.random() * (max - min) + min;
  }

  static generateRandomBoolean(): boolean {
    return Math.random() > 0.5;
  }

  /**
   * Create a test timeout that fails the test if exceeded
   */
  static createTestTimeout(ms: number): NodeJS.Timeout {
    return setTimeout(() => {
      throw new Error(`Test timeout exceeded: ${ms}ms`);
    }, ms);
  }

  /**
   * Clear a test timeout
   */
  static clearTestTimeout(timeout: NodeJS.Timeout): void {
    clearTimeout(timeout);
  }

  /**
   * Measure execution time of a function
   */
  static async measureTime<T>(fn: () => Promise<T> | T): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    return { result, duration };
  }

  /**
   * Create a mock that fails after a certain number of calls
   */
  static createFailingMock(failAfter: number, error: Error = new Error("Mock failure")) {
    let callCount = 0;
    return jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount > failAfter) {
        throw error;
      }
      return Promise.resolve();
    });
  }

  /**
   * Create a mock that succeeds after a certain number of failures
   */
  static createEventuallySucceedingMock<T>(
    failCount: number,
    successValue: T,
    error: Error = new Error("Mock failure")
  ) {
    let callCount = 0;
    return jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= failCount) {
        throw error;
      }
      return Promise.resolve(successValue);
    });
  }
}
