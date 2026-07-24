import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  FIXTURE_SURFACE_ID_PATTERN,
  fixtureToolError,
  loadFixture,
  parseFixtureSurfaceId,
} from "../src/fixtures-mcp.ts";
import type { StorageReadResult } from "../workers/storage.ts";
import { mockEnv, type AnyFn, type Row } from "./row-type.ts";

type ReadArtifact = (env: Env, path: string) => Promise<StorageReadResult>;

const SAMPLE_FIXTURE = {
  surface_id: "allways-api-health",
  netuid: 7,
  kind: "subnet-api",
  request: { method: "GET", url: "https://api.all-ways.io/health" },
  response: { status: 200, body: { ok: true } },
};

describe("fixtures-mcp", () => {
  test("FIXTURE_SURFACE_ID_PATTERN accepts slug-style ids and rejects path traversal", () => {
    assert.ok(FIXTURE_SURFACE_ID_PATTERN.test("allways-api-health"));
    assert.ok(FIXTURE_SURFACE_ID_PATTERN.test("7:subnet-api:new"));
    assert.equal(FIXTURE_SURFACE_ID_PATTERN.test("../secrets"), false);
  });

  test("fixtureToolError is shaped for MCP toolError handling", () => {
    const err = fixtureToolError("not_found", "missing");
    assert.equal(err.code, "not_found");
    assert.equal(err.toolError, true);
    assert.equal(err.message, "missing");
  });

  test("parseFixtureSurfaceId validates and trims surface_id input", () => {
    assert.equal(
      parseFixtureSurfaceId({ surface_id: " allways-api-health " }),
      "allways-api-health",
    );
  });

  test("parseFixtureSurfaceId rejects missing surface_id", () => {
    assert.throws(
      () => parseFixtureSurfaceId({}),
      ((err: Row) => err.code === "invalid_params") as AnyFn,
    );
  });

  test("parseFixtureSurfaceId rejects empty surface_id", () => {
    assert.throws(
      () => parseFixtureSurfaceId({ surface_id: "   " }),
      ((err: Row) => err.code === "invalid_params") as AnyFn,
    );
  });

  test("parseFixtureSurfaceId rejects path-traversal surface ids", () => {
    assert.throws(
      () => parseFixtureSurfaceId({ surface_id: "../secrets" }),
      ((err: Row) => err.code === "invalid_params") as AnyFn,
    );
  });

  test("loadFixture returns the baked artifact payload", async () => {
    const ctx = {
      env: mockEnv(),
      readArtifact: (async (_env: Row, path: string) => ({
        ok: true,
        data:
          path === "/metagraph/fixtures/allways-api-health.json"
            ? SAMPLE_FIXTURE
            : null,
      })) as unknown as ReadArtifact,
    };
    const out = (await loadFixture(ctx, {
      surface_id: "allways-api-health",
    })) as Row;
    assert.equal(out.surface_id, "allways-api-health");
    assert.equal(out.response.status, 200);
  });

  test("loadFixture uses an injected readArtifact dep", async () => {
    const out = (await loadFixture(
      {
        env: mockEnv(),
        readArtifact: (async () => ({ ok: false })) as unknown as ReadArtifact,
      },
      { surface_id: "solo" },
      {
        readArtifact: (async (_env: Row, path: string) => ({
          ok: true,
          data:
            path === "/metagraph/fixtures/solo.json"
              ? { surface_id: "solo" }
              : null,
        })) as unknown as ReadArtifact,
      },
    )) as Row;
    assert.equal(out.surface_id, "solo");
  });

  test("loadFixture resolves a deprecated surface_id alias", async () => {
    const ctx = {
      env: mockEnv(),
      readArtifact: (async (_env: Row, path: string) => {
        if (path === "/metagraph/operational-surfaces.json") {
          return {
            ok: true,
            data: {
              surfaces: [
                {
                  surface_id: "7:subnet-api:new",
                  surface_key: "srf-renamed",
                  netuid: 7,
                },
              ],
            },
          };
        }
        if (path === "/metagraph/surface-aliases.json") {
          return {
            ok: true,
            data: {
              aliases: [
                {
                  deprecated_id: "7:subnet-api:old",
                  surface_key: "srf-renamed",
                  current_id: "7:subnet-api:new",
                  netuid: 7,
                },
              ],
            },
          };
        }
        if (path === "/metagraph/fixtures/7:subnet-api:new.json") {
          return {
            ok: true,
            data: { surface_id: "7:subnet-api:new", renamed: true },
          };
        }
        return { ok: false, code: "artifact_not_found" };
      }) as unknown as ReadArtifact,
    };
    const out = (await loadFixture(ctx, {
      surface_id: "7:subnet-api:old",
    })) as Row;
    assert.equal(out.renamed, true);
  });

  test("loadFixture resolves a surface via direct catalog hit (no alias lookup)", async () => {
    const ctx = {
      env: mockEnv(),
      readArtifact: (async (_env: Row, path: string) => {
        if (path === "/metagraph/operational-surfaces.json") {
          return {
            ok: true,
            data: {
              surfaces: [
                { surface_id: "allways-api-health", surface_key: "srf-1" },
              ],
            },
          };
        }
        if (path === "/metagraph/fixtures/allways-api-health.json") {
          return { ok: true, data: SAMPLE_FIXTURE };
        }
        return { ok: false, code: "artifact_not_found" };
      }) as unknown as ReadArtifact,
    };
    const out = (await loadFixture(ctx, {
      surface_id: "allways-api-health",
    })) as Row;
    assert.equal(out.surface_id, "allways-api-health");
  });

  test("loadFixture maps artifact_not_found to not_found", async () => {
    const ctx = {
      env: mockEnv(),
      readArtifact: (async () => ({
        ok: false,
        code: "artifact_not_found",
      })) as unknown as ReadArtifact,
    };
    await assert.rejects(
      () => loadFixture(ctx, { surface_id: "missing" }),
      ((err: Row) =>
        err.code === "not_found" &&
        /No resource at the requested identifier/.test(err.message)) as AnyFn,
    );
  });

  test("loadFixture surfaces other artifact failures with the path", async () => {
    const ctx = {
      env: mockEnv(),
      readArtifact: (async () => ({
        ok: false,
        code: "artifact_timeout",
      })) as unknown as ReadArtifact,
    };
    await assert.rejects(
      () => loadFixture(ctx, { surface_id: "allways-api-health" }),
      ((err: Row) =>
        err.code === "artifact_timeout" &&
        /fixtures\/allways-api-health\.json/.test(err.message)) as AnyFn,
    );
  });

  test("loadFixture defaults code when the read result is bare", async () => {
    const ctx = {
      env: mockEnv(),
      readArtifact: (async () => ({ ok: false })) as unknown as ReadArtifact,
    };
    await assert.rejects(
      () => loadFixture(ctx, { surface_id: "allways-api-health" }),
      ((err: Row) => err.code === "artifact_unavailable") as AnyFn,
    );
  });
});
