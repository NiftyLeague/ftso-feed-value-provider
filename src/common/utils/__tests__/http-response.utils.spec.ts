import {
  createSuccessResponse,
  createErrorResponse,
  throwHttpException,
  handleAsyncOperation,
} from "../http-response.utils";
import { HttpException, HttpStatus } from "@nestjs/common";

describe("HTTP Response Utils", () => {
  describe("createSuccessResponse", () => {
    it("should create success response with data", () => {
      const data = { message: "test" };
      const response = createSuccessResponse(data);

      expect(response).toEqual({
        success: true,
        timestamp: expect.any(Number),
        data,
      });
    });

    it("should create success response with options", () => {
      const data = { message: "test" };
      const options = {
        responseTime: 100,
        requestId: "req-123",
        message: "Success",
      };
      const response = createSuccessResponse(data, options);

      expect(response).toEqual({
        success: true,
        timestamp: expect.any(Number),
        data,
        requestId: "req-123",
      });
    });
  });

  describe("createErrorResponse", () => {
    it("should create error response", () => {
      const response = createErrorResponse("VALIDATION_ERROR", "Invalid input");

      expect(response).toEqual({
        status: "error",
        timestamp: expect.any(Number),
        error: "VALIDATION_ERROR",
        message: "Invalid input",
      });
    });

    it("should create error response with options", () => {
      const options = {
        responseTime: 100,
        requestId: "req-123",
        details: { field: "name" },
        path: "/api/test",
        stack: "Error stack",
      };
      const response = createErrorResponse("VALIDATION_ERROR", "Invalid input", options);

      expect(response).toEqual({
        status: "error",
        timestamp: expect.any(Number),
        error: "VALIDATION_ERROR",
        message: "Invalid input",
        ...options,
      });
    });
  });

  describe("throwHttpException", () => {
    it("should throw HttpException with correct status", () => {
      expect(() => {
        throwHttpException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Test error");
      }).toThrow(HttpException);
    });
  });

  describe("handleAsyncOperation", () => {
    it("should handle successful async operation", async () => {
      const operation = async () => "success";
      const result = await handleAsyncOperation(operation, "test operation");

      expect(result).toBe("success");
    });

    it("should handle failed async operation", async () => {
      const operation = async () => {
        throw new Error("test error");
      };

      await expect(handleAsyncOperation(operation, "test operation")).rejects.toThrow("test error");
    });
  });
});
