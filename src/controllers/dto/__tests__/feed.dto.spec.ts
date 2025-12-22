import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { FeedValuesRequestDto, FeedValuesResponseDto } from "../feed.dto";

describe("feed.dto", () => {
  it("should validate FeedValuesRequestDto feeds constraints", () => {
    const valid = plainToInstance(FeedValuesRequestDto, {
      feeds: [{ category: 1, name: "BTC/USD" }],
    });

    const validErrors = validateSync(valid);
    expect(validErrors).toHaveLength(0);

    const invalid = plainToInstance(FeedValuesRequestDto, {
      feeds: [],
    });

    const invalidErrors = validateSync(invalid);
    expect(invalidErrors.length).toBeGreaterThan(0);
  });

  it("should allow constructing response DTOs", () => {
    const resp = plainToInstance(FeedValuesResponseDto, {
      data: [],
    });

    expect(resp.data).toEqual([]);
  });
});
