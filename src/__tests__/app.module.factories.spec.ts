import { MODULE_METADATA } from "@nestjs/common/constants";

import { AppModule } from "@/app.module";
import { DebugService } from "@/common/debug/debug.service";
import { ENV_HELPERS } from "@/config/environment.constants";

describe("AppModule provider factories", () => {
  it("should create DebugService only in development", () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule) as any[];
    const debugProvider = providers.find(p => p && p.provide === DebugService);

    expect(debugProvider).toBeDefined();
    expect(typeof debugProvider.useFactory).toBe("function");

    const spy = jest.spyOn(ENV_HELPERS, "isDevelopment");

    spy.mockReturnValue(true);
    expect(debugProvider.useFactory()).toBeInstanceOf(DebugService);

    spy.mockReturnValue(false);
    expect(debugProvider.useFactory()).toBeNull();

    spy.mockRestore();
  });
});
