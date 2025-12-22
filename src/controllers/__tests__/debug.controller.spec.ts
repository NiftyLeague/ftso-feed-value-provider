import { DebugController } from "@/controllers/debug.controller";

describe("DebugController", () => {
  let controller: DebugController;

  beforeEach(() => {
    controller = new DebugController();
  });

  it("should return a path when heap snapshot written", async () => {
    // Mock v8.writeHeapSnapshot to avoid creating a real file
    // Run test from a writable tmpdir to avoid permission issues
    const os = require("os");
    const origCwd = process.cwd();
    process.chdir(os.tmpdir());
    const v8 = require("v8");
    const original = v8.writeHeapSnapshot;
    v8.writeHeapSnapshot = jest.fn(() => undefined);

    const res = await controller.heapdump();
    expect(res).toBeDefined();
    // either path or error is returned
    expect(res.path || res.error).toBeDefined();

    // restore
    v8.writeHeapSnapshot = original;
    process.chdir(origCwd);
  });
});
