import { describe, expect, it } from "vitest";
import { CLAUDE_CALLBACK, isAllowedRedirect } from "../src/domain/redirect";

describe("isAllowedRedirect", () => {
  it("accepts Claude's callback and loopback callbacks on any port", () => {
    expect(isAllowedRedirect(CLAUDE_CALLBACK)).toBe(true);
    expect(isAllowedRedirect("http://localhost:3118/callback")).toBe(true);
    expect(isAllowedRedirect("http://127.0.0.1/callback")).toBe(true);
    expect(isAllowedRedirect("http://[::1]:9/callback")).toBe(true);
  });

  it("refuses look-alikes and other schemes, hosts and paths", () => {
    for (const uri of [
      "https://claude.ai/other",
      "https://claude.ai.evil.example/api/mcp/auth_callback",
      "http://claude.ai/api/mcp/auth_callback",
      "https://localhost/callback",
      "http://localhost.evil.example/callback",
      "http://localhost:80/other",
      "http://user@localhost/callback",
      "http://localhost/callback#frag",
      "com.example.app:/callback",
      "not a url",
      "",
    ]) {
      expect(isAllowedRedirect(uri), uri).toBe(false);
    }
  });

  it("accepts an exact address from config", () => {
    expect(isAllowedRedirect("https://tool.example/cb", ["https://tool.example/cb"])).toBe(true);
    expect(isAllowedRedirect("https://tool.example/cb2", ["https://tool.example/cb"])).toBe(false);
  });
});
