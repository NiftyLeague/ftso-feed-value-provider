/**
 * Port Utilities for Testing
 *
 * Provides utilities for dynamic port allocation to prevent EADDRINUSE errors in tests
 */

import * as net from "net";

/**
 * Find an available port starting from a base port
 */
export async function getAvailablePort(basePort: number = 3101): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(basePort, () => {
      const port = (server.address() as net.AddressInfo)?.port;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error("Failed to get port from server"));
        }
      });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Try next port
        getAvailablePort(basePort + 1)
          .then(resolve)
          .catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Get a random available port
 */
export async function getRandomAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo)?.port;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error("Failed to get random port"));
        }
      });
    });

    server.on("error", reject);
  });
}

/**
 * Check if a port is available
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();

    server.listen(port, () => {
      server.close(() => resolve(true));
    });

    server.on("error", () => resolve(false));
  });
}

/**
 * Set up dynamic port for tests
 * This should be called in test setup to avoid port conflicts
 */
export async function setupTestPort(): Promise<number> {
  const availablePort = await getRandomAvailablePort();

  // Set the port in environment for the test
  process.env.APP_PORT = availablePort.toString();
  process.env.VALUE_PROVIDER_CLIENT_PORT = availablePort.toString();

  return availablePort;
}
