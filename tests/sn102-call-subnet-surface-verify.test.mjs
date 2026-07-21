// SN102 (ConnitoAI) end-to-end verification for the call_subnet_surface MCP
// tool (metagraphed#7114, MCP execute Phase 1 follow-up #7014/#7215). Unlike
// tests/call-subnet-surface-mcp.test.mjs -- which proves the tool wiring with
// synthetic surfaces -- this file pins SN102's *real* registry surface configs
// (registry/subnets/connitoai.json) to the tool's contract, so a future edit
// that regresses their callability (flipping to HEAD, marking one
// auth_required, disabling a probe, dropping the captured schema) is caught
// here.
//
// All six surfaces listed in #7114 were verified live on 2026-07-21 against
// their exact catalogued URLs on cycle-api.connito.ai (the SN Owner "Phase
// Service"). Despite the Cloudflare-WAF caveat noted on the registry entries,
// every request returned HTTP 200 application/json:
//   sn-102-connito-phase-openapi          GET /openapi.json
//     -> OpenAPI 3.1.0 document {openapi, info:{title:"Phase Service"}, paths}
//   sn-102-connito-phase-get-phase        GET /get_phase
//     -> {block, cycle_length, cycle_index, cycle_block_index, phase_name,
//         phase_index, phase_start_block, phase_end_block, blocks_into_phase,
//         blocks_remaining_in_phase}
//   sn-102-connito-blocks-until-next-phase GET /blocks_until_next_phase
//     -> object keyed by phase name -> [start_block, end_block, n] triples
//   sn-102-connito-init-peer-id           GET /get_init_peer_id
//     -> JSON array of init peer ids (empty [] at capture time)
//   sn-102-connito-validator-whitelist    GET /get_validator_whitelist
//     -> JSON array of SS58 address strings
//   sn-102-connito-phase-status           GET /
//     -> {message:"Phase service is running", cycle_length,
//         phases:[{index, name, length}, ...]}
// The fixtures below mirror each live response's shape rather than fetching it,
// keeping the test hermetic while still exercising the JSON parse-and-return
// path against each upstream's actual observed behavior. (Block heights, peer
// ids, and the whitelist are live data, so the tests assert the stable shape,
// not exact contents.)
//
// Note on sn-102-connito-phase-openapi: kind "openapi" is not in
// OPERATIONAL_SURFACE_KINDS (src/health-probe-core.mjs), so that surface is
// absent from public/metagraph/operational-surfaces.json and cannot be
// resolved through the call_subnet_surface tool in production. Per #7114, a
// direct request to the URL is equally valid verification for a no-auth GET
// surface, so it is pinned here at the callSubnetSurface module level only --
// no MCP-tool-path test fakes a catalog entry production does not have.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { callSubnetSurface } from "../src/call-subnet-surface.mjs";
import { OPERATIONAL_SURFACE_KINDS } from "../src/health-probe-core.mjs";
import { handleMcpRequest } from "../src/mcp-server.mjs";

const NETUID = 102;

const registry = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../registry/subnets/connitoai.json", import.meta.url),
    ),
    "utf8",
  ),
);

function surfaceOf(id) {
  return registry.surfaces.find((surface) => surface.id === id);
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// Builds the operational-surfaces.json catalog shape from a real registry
// surface (the artifact flattens each surface's `id` to a top-level
// `surface_id`) and calls the tool through the real JSON-RPC path.
async function callToolWithSurface(surface, upstreamResponse) {
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
    const url = String(input);
    // DoH lookups for the SSRF guard: no Answer -> fail open (safe).
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      return new Response(JSON.stringify({ Status: 0 }), {
        headers: { "content-type": "application/dns-json" },
      });
    }
    return upstreamResponse();
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
            arguments: { surface_id: surface.id },
          },
        }),
      }),
      {},
      deps,
    );
    return (await response.json()).result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// The five no-auth GET subnet-api surfaces resolve through the tool's
// operational catalog, so each gets the full three-test treatment: config,
// direct module call, and MCP-tool-path call. Their live bodies differ in
// shape, so each carries a faithful fixture and a shape assertion.
const SUBNET_API_SURFACES = [
  {
    id: "sn-102-connito-phase-get-phase",
    url: "https://cycle-api.connito.ai/get_phase",
    body: {
      block: 8668092,
      cycle_length: 524,
      cycle_index: 16542,
      cycle_block_index: 84,
      phase_name: "Train",
      phase_index: 1,
      phase_start_block: 8668028,
      phase_end_block: 8668327,
      blocks_into_phase: 64,
      blocks_remaining_in_phase: 235,
    },
    assertShape(body) {
      assert.equal(typeof body.block, "number");
      assert.equal(typeof body.cycle_length, "number");
      assert.equal(typeof body.phase_name, "string");
      assert.equal(typeof body.blocks_remaining_in_phase, "number");
    },
  },
  {
    id: "sn-102-connito-blocks-until-next-phase",
    url: "https://cycle-api.connito.ai/blocks_until_next_phase",
    body: {
      Distribute: [8668532, 8668551, 440],
      Train: [8668552, 8668851, 460],
      MinerCommit1: [8668328, 8668338, 236],
    },
    assertShape(body) {
      // Object keyed by phase name -> [start_block, end_block, n] triple.
      assert.ok(Array.isArray(body.Train));
      assert.equal(body.Train.length, 3);
      assert.equal(typeof body.Train[0], "number");
    },
  },
  {
    id: "sn-102-connito-init-peer-id",
    url: "https://cycle-api.connito.ai/get_init_peer_id",
    // Live body at capture time was an empty JSON array.
    body: [],
    assertShape(body) {
      assert.ok(Array.isArray(body));
    },
  },
  {
    id: "sn-102-connito-validator-whitelist",
    url: "https://cycle-api.connito.ai/get_validator_whitelist",
    // Live body: JSON array of SS58 address strings.
    body: [
      "5EEinUEy3cfBCUyhbvCcYfWU713QCsDoVXqbbRLKFtEqKkC9",
      "5HB2ij4XvoH2owPUKhhgtM9ReD5JssXgx938kAYajaWYEz4U",
    ],
    assertShape(body) {
      assert.ok(Array.isArray(body));
      assert.equal(typeof body[0], "string");
    },
  },
  {
    id: "sn-102-connito-phase-status",
    url: "https://cycle-api.connito.ai/",
    body: {
      message: "Phase service is running",
      cycle_length: 524,
      phases: [
        { index: 0, name: "Distribute", length: 20 },
        { index: 1, name: "Train", length: 300 },
      ],
    },
    assertShape(body) {
      assert.equal(typeof body.message, "string");
      assert.equal(typeof body.cycle_length, "number");
      assert.ok(Array.isArray(body.phases));
      assert.equal(typeof body.phases[0].name, "string");
    },
  },
];

describe("SN102 ConnitoAI call_subnet_surface verification (#7114)", () => {
  for (const spec of SUBNET_API_SURFACES) {
    describe(spec.id, () => {
      const SURFACE = surfaceOf(spec.id);

      test("registry surface exists and is configured to be callable", () => {
        assert.ok(SURFACE, `registry surface ${spec.id} is present`);
        assert.equal(SURFACE.kind, "subnet-api");
        assert.equal(SURFACE.auth_required, false);
        assert.equal(SURFACE.probe?.enabled, true);
        // No-auth GET returning JSON.
        assert.equal(SURFACE.probe?.method, "GET");
        assert.equal(SURFACE.probe?.expect, "json");
        assert.equal(SURFACE.url, spec.url);
        // Single fixed endpoint -- no machine-readable schema is expected.
        assert.equal(SURFACE.schema_url, undefined);
      });

      test("callSubnetSurface returns the real JSON body using the surface's own url + GET", async () => {
        let requestedUrl;
        let requestedMethod;
        const result = await callSubnetSurface(SURFACE, {
          isUnsafeUrl: async () => false,
          fetchImpl: async (url, init) => {
            requestedUrl = String(url);
            requestedMethod = init.method;
            return jsonResponse(spec.body);
          },
        });
        assert.equal(result.ok, true);
        assert.equal(requestedUrl, SURFACE.url);
        assert.equal(requestedMethod, "GET");
        assert.equal(result.status_code, 200);
        assert.equal(result.content_type, "application/json");
        assert.equal(result.truncated, false);
        spec.assertShape(result.body);
      });

      test("end-to-end through the call_subnet_surface MCP tool, resolved by surface id", async () => {
        const result = await callToolWithSurface(SURFACE, () =>
          jsonResponse(spec.body),
        );
        assert.equal(result.isError, false);
        assert.equal(result.structuredContent.surface_id, spec.id);
        assert.equal(result.structuredContent.status_code, 200);
        spec.assertShape(result.structuredContent.body);
      });
    });
  }

  describe("sn-102-connito-phase-openapi (direct-call only)", () => {
    const SURFACE = surfaceOf("sn-102-connito-phase-openapi");
    // Faithful subset of the live /openapi.json response's top-level shape.
    const BODY = {
      openapi: "3.1.0",
      info: { title: "Phase Service", version: "0.1.0" },
      paths: {
        "/get_phase": { get: { operationId: "read_phase_get_phase_get" } },
      },
    };

    test("registry surface exists, is no-auth GET, and carries its captured schema", () => {
      assert.ok(
        SURFACE,
        "registry surface sn-102-connito-phase-openapi is present",
      );
      assert.equal(SURFACE.kind, "openapi");
      assert.equal(SURFACE.auth_required, false);
      assert.equal(SURFACE.probe?.enabled, true);
      assert.equal(SURFACE.probe?.method, "GET");
      assert.equal(SURFACE.probe?.expect, "json");
      assert.equal(SURFACE.url, "https://cycle-api.connito.ai/openapi.json");
      // #7114 says this surface has a captured schema; pin that linkage.
      assert.equal(SURFACE.schema_status, "machine-readable");
      assert.equal(
        SURFACE.schema_url,
        "https://cycle-api.connito.ai/openapi.json",
      );
    });

    test('kind "openapi" is not an operational kind, so this surface is direct-call verified', () => {
      // Documents WHY there is no MCP-tool-path test for this surface: the
      // operational catalog the tool resolves from only includes these kinds.
      assert.ok(!OPERATIONAL_SURFACE_KINDS.includes("openapi"));
      assert.ok(OPERATIONAL_SURFACE_KINDS.includes("subnet-api"));
    });

    test("callSubnetSurface returns the OpenAPI 3.1 document as parsed JSON", async () => {
      let requestedUrl;
      let requestedMethod;
      const result = await callSubnetSurface(SURFACE, {
        isUnsafeUrl: async () => false,
        fetchImpl: async (url, init) => {
          requestedUrl = String(url);
          requestedMethod = init.method;
          return jsonResponse(BODY);
        },
      });
      assert.equal(result.ok, true);
      assert.equal(requestedUrl, SURFACE.url);
      assert.equal(requestedMethod, "GET");
      assert.equal(result.status_code, 200);
      assert.equal(result.truncated, false);
      assert.equal(result.body.openapi, "3.1.0");
      assert.equal(result.body.info.title, "Phase Service");
      assert.equal(
        result.body.paths["/get_phase"].get.operationId,
        "read_phase_get_phase_get",
      );
    });
  });
});
