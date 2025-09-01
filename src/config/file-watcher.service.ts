import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { BaseService } from "@/common/base/base.service";
import { watchFile, unwatchFile } from "fs";

export interface FileWatcherOptions {
  interval?: number;
  persistent?: boolean;
}

export interface FileChangeCallback {
  (filePath: string, current: any, previous: any): void;
}

@Injectable()
export class FileWatcherService extends BaseService implements OnModuleDestroy {
  private watchedFiles = new Map<
    string,
    {
      callback: FileChangeCallback;
      options: FileWatcherOptions;
    }
  >();

  constructor() {
    super("FileWatcherService", true);
  }

  /**
   * Watch a file for changes
   */
  watchFile(filePath: string, callback: FileChangeCallback, options: FileWatcherOptions = {}): void {
    if (this.watchedFiles.has(filePath)) {
      this.logger.warn(`File ${filePath} is already being watched, replacing callback`);
      this.unwatchFile(filePath);
    }

    const watchOptions = {
      interval: options.interval || 1000,
      persistent: options.persistent !== false,
    };

    try {
      watchFile(filePath, watchOptions, (curr, prev) => {
        if (curr.mtime !== prev.mtime) {
          this.logger.debug(`File changed: ${filePath}`);
          callback(filePath, curr, prev);
        }
      });

      this.watchedFiles.set(filePath, { callback, options: watchOptions });
      this.logger.log(`Started watching file: ${filePath}`);
    } catch (error) {
      this.logger.error(`Failed to watch file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Stop watching a file
   */
  unwatchFile(filePath: string): void {
    if (!this.watchedFiles.has(filePath)) {
      this.logger.warn(`File ${filePath} is not being watched`);
      return;
    }

    try {
      unwatchFile(filePath);
      this.watchedFiles.delete(filePath);
      this.logger.log(`Stopped watching file: ${filePath}`);
    } catch (error) {
      this.logger.error(`Failed to unwatch file ${filePath}:`, error);
    }
  }

  /**
   * Check if a file is being watched
   */
  isWatching(filePath: string): boolean {
    return this.watchedFiles.has(filePath);
  }

  /**
   * Get list of watched files
   */
  getWatchedFiles(): string[] {
    return Array.from(this.watchedFiles.keys());
  }

  /**
   * Get watch status for all files
   */
  getWatchStatus(): Array<{
    filePath: string;
    options: FileWatcherOptions;
  }> {
    return Array.from(this.watchedFiles.entries()).map(([filePath, { options }]) => ({
      filePath,
      options,
    }));
  }

  /**
   * Stop watching all files
   */
  unwatchAllFiles(): void {
    const filePaths = Array.from(this.watchedFiles.keys());

    for (const filePath of filePaths) {
      this.unwatchFile(filePath);
    }

    this.logger.log(`Stopped watching ${filePaths.length} files`);
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy(): void {
    this.logger.log("FileWatcherService shutting down, unwatching all files");
    this.unwatchAllFiles();
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    timestamp: number;
    details?: any;
  }> {
    const watchedCount = this.watchedFiles.size;

    return {
      status: "healthy",
      timestamp: Date.now(),
      details: {
        watchedFilesCount: watchedCount,
        watchedFiles: this.getWatchedFiles(),
      },
    };
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(): Promise<{
    responseTime: { average: number; min: number; max: number };
    throughput: { requestsPerSecond: number; totalRequests: number };
    errorRate: number;
    uptime: number;
  }> {
    const uptime = process.uptime();

    return {
      responseTime: {
        average: 1, // File watching is very fast
        min: 0,
        max: 5,
      },
      throughput: {
        requestsPerSecond: 0, // Not applicable for file watching
        totalRequests: this.watchedFiles.size,
      },
      errorRate: 0, // Mock value
      uptime,
    };
  }
}
