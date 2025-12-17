import { Controller, Get } from "@nestjs/common";
import { ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { HttpErrorResponseDto } from "./dto/common-error.dto";
import { HeapDumpResponseDto } from "./dto/debug.dto";

@ApiTags("Debug")
@Controller("debug")
@ApiExtraModels(HeapDumpResponseDto, HttpErrorResponseDto)
export class DebugController {
  @Get("/heapdump")
  @ApiOperation({
    summary: "Trigger and save a V8 heap dump",
    description:
      "Generates a V8 heap snapshot and saves it to a file. This is a debugging tool for memory leak analysis. The file is saved to the `/logs` directory if writable (in a container), otherwise to a local `logs/` directory.",
  })
  @ApiResponse({
    status: 200,
    description: "Heap dump operation completed. The response indicates success or failure.",
    type: HeapDumpResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: "An unexpected error occurred while trying to generate the heap dump.",
    type: HttpErrorResponseDto,
  })
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
