import { Controller, Get } from "@nestjs/common";

@Controller("debug")
export class DebugController {
  @Get("/heapdump")
  async heapdump(): Promise<{ path?: string; error?: string }> {
    try {
      const v8 = await import("v8");
      const fs = await import("fs");
      const pathMod = await import("path");
      const now = Date.now();

      // Determine heap dump directory:
      // Prefer `/logs` when writable (container-mounted volume), otherwise
      // fallback to a project-local `logs/` directory for local runs.
      const preferred = "/logs";
      let dir = preferred;

      try {
        fs.accessSync(preferred, fs.constants.W_OK);
      } catch {
        dir = pathMod.join(process.cwd(), "logs");
      }

      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (mkErr) {
        return { error: `Unable to create heap dump dir ${dir}: ${String(mkErr)}` };
      }

      const filePath = pathMod.join(dir, `heap-${now}.heapsnapshot`);
      try {
        v8.writeHeapSnapshot(filePath);
      } catch (writeErr) {
        return { error: `Failed to write heap snapshot: ${String(writeErr)}` };
      }

      return { path: filePath };
    } catch (e: unknown) {
      return { error: String(e) };
    }
  }
}
