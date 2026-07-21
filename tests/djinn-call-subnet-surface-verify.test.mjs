// SN103 (Djinn) end-to-end verification for the call_subnet_surface MCP tool
// (metagraphed MCP execute Phase 1 #7014/#7215; issue #7115).
// Unlike tests/call-subnet-surface-mcp.test.mjs -- which proves the tool wiring
// with synthetic surfaces -- this file pins SN103's *real* registry surface
// config (registry/subnets/djinn.json) to the tool's contract, so a future edit
// that regresses any of these surfaces' callability (flipping to HEAD, marking
// it auth_required, disabling its probe, moving the url) is caught here.
//
// SN103 registers seven public no-auth subnet-api surfaces on www.djinn.gg,
// each a single fixed GET endpoint returning application/json. All seven were
// live-verified 2026-07-21 to return HTTP 200 application/json with a fast TTFB
// (<1s): /api/health (status/version/timestamp liveness), /api/sports (supported
// sports list), /api/miners/discover (registered miner list + count),
// /api/network/config (validator endpoint list), /api/network/matrix
// (per-validator health matrix), /api/network/status (network summary counters),
// and /api/validators/discover (registered validator list + count). The fixtures
// below mirror the observed top-level shape of each response rather than fetching
// it, keeping the tests hermetic while still exercising the tool's JSON
// parse-and-return path.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { callSubnetSurface } from "../src/call-subnet-surface.mjs";
import { handleMcpRequest } from "../src/mcp-server.mjs";

const NETUID = 103;

const registry = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../registry/subnets/djinn.json", import.meta.url)),
    "utf8",
  ),
);

// Faithful subsets of the live SN103 responses (top-level shape only), each
// keyed to the surface it verifies. `check` asserts a stable field so a shape
// regression in the tool's parse-and-return path is caught.
const SURFACES = [
  {
    id: "sn-103-djinn-health",
    url: "https://www.djinn.gg/api/health",
    body: {
      status: "ok",
      version: "0.1.0",
      timestamp: "2026-07-21T00:00:00.000Z",
    },
    check: (body) => assert.equal(body.status, "ok"),
  },
  {
    id: "sn-103-djinn-sports",
    url: "https://www.djinn.gg/api/sports",
    body: {
      sports: [{ key: "basketball_nba", name: "NBA", category: "Basketball" }],
    },
    check: (body) => {
      assert.ok(Array.isArray(body.sports));
      assert.equal(body.sports[0].key, "basketball_nba");
    },
  },
  {
    id: "sn-103-djinn-miners-discover",
    url: "https://www.djinn.gg/api/miners/discover",
    body: {
      miners: [{ uid: 0, stake: "0", incentive: 0 }],
      served_by_uid: 0,
      miner_count: 249,
      served_at_ms: 1784613986399,
    },
    check: (body) => {
      assert.ok(Array.isArray(body.miners));
      assert.equal(typeof body.miner_count, "number");
    },
  },
  {
    id: "sn-103-djinn-network-config",
    url: "https://www.djinn.gg/api/network/config",
    body: {
      validators: [
        {
          uid: 0,
          name: "UID 0",
          endpoint: "http://example:8421",
          pubkey: null,
        },
      ],
    },
    check: (body) => {
      assert.ok(Array.isArray(body.validators));
      assert.equal(typeof body.validators[0].endpoint, "string");
    },
  },
  {
    id: "sn-103-djinn-network-matrix",
    url: "https://www.djinn.gg/api/network/matrix",
    body: {
      validators: [
        { uid: 0, stake: "0", version: 1989, healthy: true, miners: [] },
      ],
      minerUids: [0, 1, 2],
      timestamp: 1784613986399,
      served_by_uid: 0,
    },
    check: (body) => {
      assert.ok(Array.isArray(body.validators));
      assert.ok(Array.isArray(body.minerUids));
    },
  },
  {
    id: "sn-103-djinn-network-status",
    url: "https://www.djinn.gg/api/network/status",
    body: {
      summary: {
        totalValidators: 5,
        totalMiners: 249,
        validatorsHealthy: 4,
        totalShares: 7925,
        gini: 0.01,
        burnPercent: 0.0,
      },
    },
    check: (body) => {
      assert.equal(typeof body.summary, "object");
      assert.equal(typeof body.summary.totalMiners, "number");
    },
  },
  {
    id: "sn-103-djinn-validators-discover",
    url: "https://www.djinn.gg/api/validators/discover",
    body: {
      validators: [{ uid: 0, stake: "0", incentive: 0 }],
      served_by_uid: 0,
      validator_count: 7,
      served_at_ms: 1784613986399,
    },
    check: (body) => {
      assert.ok(Array.isArray(body.validators));
      assert.equal(typeof body.validator_count, "number");
    },
  },
].map((spec) => ({
  ...spec,
  surface: registry.surfaces.find((surface) => surface.id === spec.id),
}));

function upstreamResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("SN103 Djinn call_subnet_surface verification (#7115)", () => {
  for (const { id, url, body, check, surface } of SURFACES) {
    describe(id, () => {
      test("the registry surface exists and is configured to be callable", () => {
        assert.ok(surface, `registry surface ${id} is present`);
        assert.equal(surface.kind, "subnet-api");
        assert.equal(surface.auth_required, false);
        assert.equal(surface.probe?.enabled, true);
        // No-auth GET returning JSON.
        assert.equal(surface.probe?.method, "GET");
        assert.equal(surface.probe?.expect, "json");
        assert.equal(surface.url, url);
        // Single fixed endpoint -- no machine-readable schema is expected.
        assert.equal(surface.schema_url, undefined);
      });

      test("callSubnetSurface returns the real JSON body using the surface's own url + GET", async () => {
        let requestedUrl;
        let requestedMethod;
        const result = await callSubnetSurface(surface, {
          isUnsafeUrl: async () => false,
          fetchImpl: async (fetchUrl, init) => {
            requestedUrl = String(fetchUrl);
            requestedMethod = init.method;
            return upstreamResponse(body);
          },
        });
        assert.equal(result.ok, true);
        assert.equal(requestedUrl, surface.url);
        assert.equal(requestedMethod, "GET");
        assert.equal(result.status_code, 200);
        assert.equal(result.content_type, "application/json");
        assert.equal(result.truncated, false);
        check(result.body);
      });

      test("end-to-end through the call_subnet_surface MCP tool, resolved by surface id", async () => {
        const catalog = {
          surfaces: [{ ...surface, surface_id: surface.id, netuid: NETUID }],
        };
        const deps = {
          readArtifact: async (_env, path) =>
            path === "/metagraph/operational-surfaces.json"
              ? { ok: true, data: catalog }
              : { ok: false, status: 404 },
        };
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (input) => {
          const requested = String(input);
          if (requested.startsWith("https://cloudflare-dns.com/dns-query")) {
            return new Response(JSON.stringify({ Status: 0 }), {
              headers: { "content-type": "application/dns-json" },
            });
          }
          return upstreamResponse(body);
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
                  arguments: { surface_id: id },
                },
              }),
            }),
            {},
            deps,
          );
          const result = (await response.json()).result;
          assert.equal(result.isError, false);
          assert.equal(result.structuredContent.surface_id, id);
          assert.equal(result.structuredContent.status_code, 200);
          check(result.structuredContent.body);
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });
  }
});
