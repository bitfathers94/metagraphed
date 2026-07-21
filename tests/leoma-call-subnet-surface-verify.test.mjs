// SN99 (Leoma) end-to-end verification for the call_subnet_surface MCP tool
// (metagraphed#7111, MCP execute Phase 1 follow-up #7014/#7215). Unlike
// tests/call-subnet-surface-mcp.test.mjs -- which proves the tool wiring with
// synthetic surfaces -- this file pins SN99's *real* registry surface config
// (registry/subnets/leoma.json) to the tool's contract, so a future edit that
// regresses a surface's callability (flipping to HEAD, marking it
// auth_required, disabling its probe, moving the url) is caught here.
//
// All seven surfaces are the Leoma validator API's own no-auth GET endpoints on
// api.leoma.ai. Live-verified 2026-07-21 (each request returned HTTP 200
// application/json):
//   sn-99-leoma-health            GET /health
//     -> {status:"healthy", version:"0.3.2", database:true,
//         metagraph_synced:true, last_sync:"2026-06-26T21:06:29.781333Z"}
//   sn-99-leoma-openapi           GET /openapi.json
//     -> OpenAPI 3.1.0 doc, info.title "Leoma API", version 0.3.2
//   sn-99-leoma-miners-list       GET /miners/list
//     -> {miners:[{uid, hotkey, model_name, ...}]}
//   sn-99-leoma-samples-list      GET /samples/list
//     -> [{id, task_id, validator_hotkey, miner_hotkey, prompt, ...}]
//   sn-99-leoma-scores-validators GET /scores/validators
//     -> [{validator_hotkey, total_samples, total_passed, avg_score, ...}]
//   sn-99-leoma-tasks-latest      GET /tasks/latest   -> {task_id: 5954}
//   sn-99-leoma-weights           GET /weights
//     -> {winner_uid, miners:[{miner_hotkey, uid, pass_rate, weight}]}
//
// The six subnet-api surfaces are operational (kind "subnet-api" is in
// OPERATIONAL_SURFACE_KINDS), so each is resolved end-to-end through the MCP
// tool by surface id. The OpenAPI surface (kind "openapi") is not an
// operational kind, so it never lands in operational-surfaces.json and cannot
// be resolved by the catalog path -- it is verified via callSubnetSurface
// directly instead (same constraint as sn-74-gittensor-openapi in #7087).
//
// The fixtures below mirror faithful subsets of the live responses rather than
// fetching them, keeping the tests hermetic while still exercising the tool's
// JSON parse-and-return path.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { callSubnetSurface } from "../src/call-subnet-surface.mjs";
import { handleMcpRequest } from "../src/mcp-server.mjs";

const NETUID = 99;
const registry = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../registry/subnets/leoma.json", import.meta.url)),
    "utf8",
  ),
);
const surfaceById = (id) =>
  registry.surfaces.find((surface) => surface.id === id);

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// Operational (subnet-api) surface: pin the registry config, exercise
// callSubnetSurface directly, then resolve it end-to-end through the
// call_subnet_surface MCP tool by surface id. Mirrors the SN97/SN114
// verification shape (metagraphed#7109/#7125).
function verifyOperationalSurface({ surfaceId, url, body, assertBody }) {
  const SURFACE = surfaceById(surfaceId);

  describe(`SN99 Leoma ${surfaceId} call_subnet_surface verification (#7111)`, () => {
    test("the registry surface exists and is configured to be callable", () => {
      assert.ok(SURFACE, `registry surface ${surfaceId} is present`);
      assert.equal(SURFACE.kind, "subnet-api");
      assert.equal(SURFACE.auth_required, false);
      assert.equal(SURFACE.probe?.enabled, true);
      // No-auth GET returning JSON.
      assert.equal(SURFACE.probe?.method, "GET");
      assert.equal(SURFACE.probe?.expect, "json");
      assert.equal(SURFACE.url, url);
      // Single fixed endpoint -- no machine-readable schema is expected.
      assert.equal(SURFACE.schema_url, undefined);
    });

    test("callSubnetSurface returns the real JSON body using the surface's own url + GET", async () => {
      let requestedUrl;
      let requestedMethod;
      const result = await callSubnetSurface(SURFACE, {
        isUnsafeUrl: async () => false,
        fetchImpl: async (fetchUrl, init) => {
          requestedUrl = String(fetchUrl);
          requestedMethod = init.method;
          return jsonResponse(body);
        },
      });
      assert.equal(result.ok, true);
      assert.equal(requestedUrl, SURFACE.url);
      assert.equal(requestedMethod, "GET");
      assert.equal(result.status_code, 200);
      assert.equal(result.content_type, "application/json");
      assert.equal(result.truncated, false);
      assertBody(result.body);
    });

    test("end-to-end through the call_subnet_surface MCP tool, resolved by surface id", async () => {
      const catalog = {
        surfaces: [{ ...SURFACE, surface_id: SURFACE.id, netuid: NETUID }],
      };
      const deps = {
        readArtifact: async (_env, path) =>
          path === "/metagraph/operational-surfaces.json"
            ? { ok: true, data: catalog }
            : { ok: false, status: 404 },
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input) => {
        const requestUrl = String(input);
        if (requestUrl.startsWith("https://cloudflare-dns.com/dns-query")) {
          return new Response(JSON.stringify({ Status: 0 }), {
            headers: { "content-type": "application/dns-json" },
          });
        }
        return jsonResponse(body);
      };
      try {
        const response = await handleMcpRequest(
          new Request("https://metagraph.sh/mcp", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: {
                name: "call_subnet_surface",
                arguments: { surface_id: surfaceId },
              },
            }),
          }),
          {},
          deps,
        );
        const result = (await response.json()).result;
        assert.equal(result.isError, false);
        assert.equal(result.structuredContent.surface_id, surfaceId);
        assert.equal(result.structuredContent.status_code, 200);
        assertBody(result.structuredContent.body);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
}

// Non-operational surface (kind "openapi"): verify the registry config and the
// direct callSubnetSurface path only. It is intentionally absent from the MCP
// operational catalog, so there is no by-id tool path to exercise.
function verifyDirectSurface({ surfaceId, url, body, assertBody }) {
  const SURFACE = surfaceById(surfaceId);

  describe(`SN99 Leoma ${surfaceId} call_subnet_surface verification (#7111)`, () => {
    test("the registry surface exists and is configured to be callable", () => {
      assert.ok(SURFACE, `registry surface ${surfaceId} is present`);
      assert.equal(SURFACE.kind, "openapi");
      assert.equal(SURFACE.auth_required, false);
      assert.equal(SURFACE.probe?.enabled, true);
      assert.equal(SURFACE.probe?.method, "GET");
      assert.equal(SURFACE.probe?.expect, "json");
      assert.equal(SURFACE.url, url);
    });

    test("callSubnetSurface returns the OpenAPI JSON body using the surface's own url + GET", async () => {
      let requestedUrl;
      let requestedMethod;
      const result = await callSubnetSurface(SURFACE, {
        isUnsafeUrl: async () => false,
        fetchImpl: async (fetchUrl, init) => {
          requestedUrl = String(fetchUrl);
          requestedMethod = init.method;
          return jsonResponse(body);
        },
      });
      assert.equal(result.ok, true);
      assert.equal(requestedUrl, SURFACE.url);
      assert.equal(requestedMethod, "GET");
      assert.equal(result.status_code, 200);
      assert.equal(result.content_type, "application/json");
      assert.equal(result.truncated, false);
      assertBody(result.body);
    });
  });
}

// /health: application liveness object.
verifyOperationalSurface({
  surfaceId: "sn-99-leoma-health",
  url: "https://api.leoma.ai/health",
  body: {
    status: "healthy",
    version: "0.3.2",
    database: true,
    metagraph_synced: true,
    last_sync: "2026-06-26T21:06:29.781333Z",
  },
  assertBody: (responseBody) => {
    assert.equal(responseBody.status, "healthy");
    assert.equal(responseBody.database, true);
    assert.equal(typeof responseBody.version, "string");
  },
});

// /miners/list: the registered miners list.
verifyOperationalSurface({
  surfaceId: "sn-99-leoma-miners-list",
  url: "https://api.leoma.ai/miners/list",
  body: {
    miners: [
      {
        uid: 2,
        hotkey: "5CPxXZNBWbCvzmm9PPpGvJATBLVnFTgdWmaenGkWBijNDBGY",
        model_name: null,
        model_revision: null,
        is_valid: false,
      },
    ],
  },
  assertBody: (responseBody) => {
    assert.ok(Array.isArray(responseBody.miners));
    assert.equal(typeof responseBody.miners[0].uid, "number");
    assert.equal(typeof responseBody.miners[0].hotkey, "string");
  },
});

// /samples/list: evaluation sample records.
verifyOperationalSurface({
  surfaceId: "sn-99-leoma-samples-list",
  url: "https://api.leoma.ai/samples/list",
  body: [
    {
      id: 71250,
      task_id: 5954,
      validator_hotkey: "5CrGhhemVi8e77LRpogbQEvuqvBssaEYz2EzrUfNR5bJ1s99",
      miner_hotkey: "5GpoRvo4ANAg1QzRGyQu8nRndTERAWxQcjkpwc5iwCoTEZuV",
    },
  ],
  assertBody: (responseBody) => {
    assert.ok(Array.isArray(responseBody));
    assert.equal(typeof responseBody[0].id, "number");
    assert.equal(typeof responseBody[0].task_id, "number");
  },
});

// /scores/validators: per-validator scoring stats.
verifyOperationalSurface({
  surfaceId: "sn-99-leoma-scores-validators",
  url: "https://api.leoma.ai/scores/validators",
  body: [
    {
      validator_hotkey: "5CrGhhemVi8e77LRpogbQEvuqvBssaEYz2EzrUfNR5bJ1s99",
      total_samples: 3472,
      total_passed: 2495,
      avg_score: 0.6995807933945115,
      pass_rate: 0.7186059907834101,
    },
  ],
  assertBody: (responseBody) => {
    assert.ok(Array.isArray(responseBody));
    assert.equal(typeof responseBody[0].total_samples, "number");
    assert.equal(typeof responseBody[0].avg_score, "number");
  },
});

// /tasks/latest: the most recent evaluation task id.
verifyOperationalSurface({
  surfaceId: "sn-99-leoma-tasks-latest",
  url: "https://api.leoma.ai/tasks/latest",
  body: { task_id: 5954 },
  assertBody: (responseBody) => {
    assert.equal(typeof responseBody.task_id, "number");
  },
});

// /weights: the current round's winning miner and weight allocation.
verifyOperationalSurface({
  surfaceId: "sn-99-leoma-weights",
  url: "https://api.leoma.ai/weights",
  body: {
    winner_uid: 164,
    miners: [
      {
        miner_hotkey: "5GpoRvo4ANAg1QzRGyQu8nRndTERAWxQcjkpwc5iwCoTEZuV",
        uid: 164,
        pass_rate: 0.74,
        weight: 1.0,
      },
    ],
  },
  assertBody: (responseBody) => {
    assert.equal(typeof responseBody.winner_uid, "number");
    assert.ok(Array.isArray(responseBody.miners));
    assert.equal(typeof responseBody.miners[0].weight, "number");
  },
});

// /openapi.json: the validator API's machine-readable OpenAPI schema.
verifyDirectSurface({
  surfaceId: "sn-99-leoma-openapi",
  url: "https://api.leoma.ai/openapi.json",
  body: {
    openapi: "3.1.0",
    info: {
      title: "Leoma API",
      description: "Centralized API for Leoma subnet validators",
      version: "0.3.2",
    },
    paths: { "/health": { get: { summary: "Health Check" } } },
  },
  assertBody: (responseBody) => {
    assert.equal(responseBody.openapi, "3.1.0");
    assert.equal(responseBody.info.title, "Leoma API");
    assert.ok(responseBody.paths["/health"]);
  },
});
