import { describe, expect, it } from "vitest";
import {
  mintVisitorProof,
  parseVisitorProof,
  verifyVisitorProof,
} from "../src/proof";

const SIGNING_KEY = "xrk_test_1234567890123456";
const VISITOR_ID = "xv_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
const PROJECT_ID = "proj_test_abc123";

describe("mintVisitorProof", () => {
  it("produces a token with xvp_ prefix", async () => {
    const token = await mintVisitorProof({
      visitorId: VISITOR_ID,
      projectId: PROJECT_ID,
      signingKey: SIGNING_KEY,
    });
    expect(token).toMatch(/^xvp_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("embeds visitor_id, project_id, and exp in the payload", async () => {
    const token = await mintVisitorProof({
      visitorId: VISITOR_ID,
      projectId: PROJECT_ID,
      signingKey: SIGNING_KEY,
      ttlSeconds: 600,
    });
    const parsed = parseVisitorProof(token);
    expect(parsed).not.toBeNull();
    expect(parsed!.visitorId).toBe(VISITOR_ID);
    expect(parsed!.projectId).toBe(PROJECT_ID);
    expect(parsed!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(parsed!.exp).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000) + 600,
    );
  });

  it("uses a default TTL of 300 seconds", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await mintVisitorProof({
      visitorId: VISITOR_ID,
      projectId: PROJECT_ID,
      signingKey: SIGNING_KEY,
    });
    const parsed = parseVisitorProof(token);
    expect(parsed!.exp).toBeGreaterThanOrEqual(before + 300);
    expect(parsed!.exp).toBeLessThanOrEqual(before + 301);
  });

  it("rejects missing required fields", async () => {
    await expect(
      mintVisitorProof({
        visitorId: "",
        projectId: PROJECT_ID,
        signingKey: SIGNING_KEY,
      }),
    ).rejects.toThrow("visitorId, projectId, and signingKey are required");

    await expect(
      mintVisitorProof({
        visitorId: VISITOR_ID,
        projectId: "",
        signingKey: SIGNING_KEY,
      }),
    ).rejects.toThrow("visitorId, projectId, and signingKey are required");

    await expect(
      mintVisitorProof({
        visitorId: VISITOR_ID,
        projectId: PROJECT_ID,
        signingKey: "",
      }),
    ).rejects.toThrow("visitorId, projectId, and signingKey are required");
  });
});

describe("verifyVisitorProof", () => {
  it("verifies a correctly signed proof", async () => {
    const token = await mintVisitorProof({
      visitorId: VISITOR_ID,
      projectId: PROJECT_ID,
      signingKey: SIGNING_KEY,
    });
    const valid = await verifyVisitorProof(token, SIGNING_KEY);
    expect(valid).toBe(true);
  });

  it("rejects a proof signed with a different key", async () => {
    const token = await mintVisitorProof({
      visitorId: VISITOR_ID,
      projectId: PROJECT_ID,
      signingKey: SIGNING_KEY,
    });
    const valid = await verifyVisitorProof(token, "wrong_key_entirely");
    expect(valid).toBe(false);
  });

  it("rejects a tampered payload", async () => {
    const token = await mintVisitorProof({
      visitorId: VISITOR_ID,
      projectId: PROJECT_ID,
      signingKey: SIGNING_KEY,
    });
    const parts = token.split(".");
    parts[0] = parts[0]!.slice(0, -2) + "XX";
    const tampered = parts.join(".");
    const valid = await verifyVisitorProof(tampered, SIGNING_KEY);
    expect(valid).toBe(false);
  });

  it("rejects an expired proof", async () => {
    const token = await mintVisitorProof({
      visitorId: VISITOR_ID,
      projectId: PROJECT_ID,
      signingKey: SIGNING_KEY,
      ttlSeconds: -10,
    });
    const valid = await verifyVisitorProof(token, SIGNING_KEY);
    expect(valid).toBe(false);
  });

  it("rejects malformed tokens", async () => {
    expect(await verifyVisitorProof("", SIGNING_KEY)).toBe(false);
    expect(await verifyVisitorProof("no-dot", SIGNING_KEY)).toBe(false);
    expect(await verifyVisitorProof("xvp_no-dot", SIGNING_KEY)).toBe(false);
  });
});

describe("parseVisitorProof", () => {
  it("parses both prefixed and unprefixed tokens", async () => {
    const token = await mintVisitorProof({
      visitorId: VISITOR_ID,
      projectId: PROJECT_ID,
      signingKey: SIGNING_KEY,
    });
    const withPrefix = parseVisitorProof(token);
    const withoutPrefix = parseVisitorProof(token.slice(4));
    expect(withPrefix).toEqual(withoutPrefix);
    expect(withPrefix!.visitorId).toBe(VISITOR_ID);
  });

  it("returns null for invalid tokens", () => {
    expect(parseVisitorProof("garbage")).toBeNull();
    expect(parseVisitorProof("")).toBeNull();
    expect(parseVisitorProof(".")).toBeNull();
  });
});
