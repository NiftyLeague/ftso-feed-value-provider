import { ClientIdentificationUtils } from "../client-identification.utils";

describe("ClientIdentificationUtils", () => {
  describe("getClientInfo", () => {
    it("should extract API key from headers", () => {
      const request = {
        headers: {
          "x-api-key": "test-api-key-123",
        },
      };

      const result = ClientIdentificationUtils.getClientInfo(request);

      expect(result).toEqual({
        id: "api:test-api-key-123",
        type: "api",
        sanitized: "api:test...-123",
      });
    });

    it("should extract Bearer token from authorization header", () => {
      const request = {
        headers: {
          authorization: "Bearer test-token-456",
        },
      };

      const result = ClientIdentificationUtils.getClientInfo(request);

      expect(result).toEqual({
        id: "bearer:test-token-456",
        type: "bearer",
        sanitized: "bearer:test...-456",
      });
    });

    it("should extract client ID from custom header", () => {
      const request = {
        headers: {
          "x-client-id": "client-789",
        },
      };

      const result = ClientIdentificationUtils.getClientInfo(request);

      expect(result).toEqual({
        id: "client:client-789",
        type: "client",
        sanitized: "client:client-789",
      });
    });

    it("should fall back to IP address when no other identifiers", () => {
      const request = {
        headers: {},
        ip: "192.168.1.100",
      };

      const result = ClientIdentificationUtils.getClientInfo(request);

      expect(result).toEqual({
        id: "ip:192.168.1.100",
        type: "ip",
        sanitized: "ip:192.168.1.100",
      });
    });

    it("should prioritize API key over other identifiers", () => {
      const request = {
        headers: {
          "x-api-key": "api-key-123",
          authorization: "Bearer token-456",
          "x-client-id": "client-789",
        },
        ip: "192.168.1.100",
      };

      const result = ClientIdentificationUtils.getClientInfo(request);

      expect(result.id).toBe("api:api-key-123");
      expect(result.type).toBe("api");
    });
  });

  describe("sanitizeClientId", () => {
    it("should sanitize API key with sufficient length", () => {
      const result = ClientIdentificationUtils.sanitizeClientId("api:test-api-key-123456");

      expect(result).toBe("api:test...3456");
    });

    it("should sanitize API key with short length", () => {
      const result = ClientIdentificationUtils.sanitizeClientId("api:short");

      expect(result).toBe("api:shor...");
    });

    it("should sanitize Bearer token with sufficient length", () => {
      const result = ClientIdentificationUtils.sanitizeClientId("bearer:test-token-123456");

      expect(result).toBe("bearer:test...3456");
    });

    it("should not sanitize IP addresses", () => {
      const result = ClientIdentificationUtils.sanitizeClientId("ip:192.168.1.100");

      expect(result).toBe("ip:192.168.1.100");
    });

    it("should not sanitize client IDs", () => {
      const result = ClientIdentificationUtils.sanitizeClientId("client:client-123");

      expect(result).toBe("client:client-123");
    });
  });

  describe("sanitizeUserAgent", () => {
    it("should return user agent as-is when under 100 characters", () => {
      const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
      const result = ClientIdentificationUtils.sanitizeUserAgent(userAgent);

      expect(result).toBe(userAgent);
    });

    it("should truncate user agent when over 100 characters", () => {
      const longUserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Very Long Additional Information";
      const result = ClientIdentificationUtils.sanitizeUserAgent(longUserAgent);

      expect(result).toBe(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.12..."
      );
      expect(result.length).toBe(103); // 100 + "..."
    });

    it("should return unknown for null user agent", () => {
      const result = ClientIdentificationUtils.sanitizeUserAgent(null as any);

      expect(result).toBe("unknown");
    });

    it("should return unknown for undefined user agent", () => {
      const result = ClientIdentificationUtils.sanitizeUserAgent(undefined as any);

      expect(result).toBe("unknown");
    });

    it("should return unknown for non-string user agent", () => {
      const result = ClientIdentificationUtils.sanitizeUserAgent(123 as any);

      expect(result).toBe("unknown");
    });
  });
});
