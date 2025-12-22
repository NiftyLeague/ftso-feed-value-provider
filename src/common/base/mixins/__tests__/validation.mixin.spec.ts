import { BadRequestException } from "@nestjs/common";

import { WithValidation } from "../validation.mixin";
import type { ValidationRule } from "@/common/types/services";

class TestBase {
  public logDebug = jest.fn();
  public logWarning = jest.fn();
}

class ValidatableService extends WithValidation(TestBase) {}

describe("WithValidation mixin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("adds, updates, and removes rules with expected logging", () => {
    const svc = new ValidatableService();

    const rule1: ValidationRule<number> = { name: "r1", validate: v => v > 0, message: "must be > 0" };
    const rule1b: ValidationRule<number> = { name: "r1", validate: v => v > 1, message: "must be > 1" };

    svc.addValidationRule(rule1);
    expect(svc.getValidationRules()).toHaveLength(1);
    expect(svc.logDebug).toHaveBeenCalledWith("Added validation rule: r1");

    svc.addValidationRule(rule1b);
    expect(svc.getValidationRules()).toHaveLength(1);
    expect(svc.logDebug).toHaveBeenCalledWith("Updated validation rule: r1");

    svc.addValidationRule(rule1b, true);
    // silent update does not log
    expect(svc.logDebug).toHaveBeenCalledTimes(2);

    svc.removeValidationRule("r1");
    expect(svc.getValidationRules()).toHaveLength(0);
    expect(svc.logDebug).toHaveBeenCalledWith("Removed validation rule: r1");
  });

  it("throws BadRequestException with aggregated errors and tracks failed rules", () => {
    const svc = new ValidatableService();

    svc.addValidationRule<number>({
      name: "fails",
      validate: () => false,
      message: "nope",
    });

    svc.addValidationRule<number>({
      name: "throws",
      validate: () => {
        throw new Error("boom");
      },
    });

    expect(() => svc.validate(123)).toThrow(BadRequestException);

    const failed = svc.getFailedRules();
    expect(failed.has("fails")).toBe(true);
    expect(failed.has("throws")).toBe(true);

    expect(svc.logWarning).toHaveBeenCalledWith(
      "Validation failed with 2 errors",
      undefined,
      expect.objectContaining({
        errors: ["nope", "Validation error in rule 'throws': boom"],
      })
    );
  });

  it("clears all validation rules", () => {
    const svc = new ValidatableService();

    svc.addValidationRule<number>({ name: "r1", validate: () => true });
    expect(svc.getValidationRules()).toHaveLength(1);

    svc.clearValidationRules();
    expect(svc.getValidationRules()).toHaveLength(0);
    expect(svc.logDebug).toHaveBeenCalledWith("Cleared all validation rules");
  });
});
