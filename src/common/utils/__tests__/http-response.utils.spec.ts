import {
  createSuccessResponse,
  createErrorResponse,
  throwHttpException,
  HttpExceptions,
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

  describe("HttpExceptions", () => {
    it("badRequest throws a standardized HttpException", () => {
      try {
        HttpExceptions.badRequest("Invalid input", { requestId: "req-1" });
        throw new Error("expected HttpException");
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        const ex = e as HttpException;
        expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(ex.getResponse()).toEqual(
          expect.objectContaining({
            status: "error",
            error: "Bad Request",
            message: "Invalid input",
            requestId: "req-1",
            timestamp: expect.any(Number),
          })
        );
      }
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

    it("rethrows HttpException unchanged", async () => {
      const operation = async () => {
        throw new HttpException({ status: "error", message: "boom" }, HttpStatus.I_AM_A_TEAPOT);
      };

      await expect(handleAsyncOperation(operation, "test operation")).rejects.toBeInstanceOf(HttpException);
      await expect(handleAsyncOperation(operation, "test operation")).rejects.toMatchObject({
        status: HttpStatus.I_AM_A_TEAPOT,
      });
    });
  });
});
