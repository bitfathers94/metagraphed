// SN96 (Verathos) end-to-end verification for the call_subnet_surface MCP
// tool (metagraphed#7108, MCP execute Phase 1 follow-up #7014/#7215). Unlike
// tests/call-subnet-surface-mcp.test.mjs -- which proves the tool wiring with
// synthetic surfaces -- this file pins SN96's *real* no-auth GET JSON
// registry surfaces (registry/subnets/verathos.json) to the tool's contract.
//
// Live-verified 2026-07-21 (every fixture body below is a faithful capture of
// the actual response observed against the live URL):
//   sn-96-verathos-models-api          GET https://api.verathos.ai/v1/models
//     -> {"object":"list","data":[{"id":"qwen3.5-9b",...},...]}
//   sn-96-verathos-health              GET https://api.verathos.ai/health
//     -> {"status":"ok"}
//   sn-96-verathos-network-stats       GET https://api.verathos.ai/v1/network/stats
//     -> {"miners":[{address,ss58_address,uid,endpoint,model_id,...},...]}
//   sn-96-verathos-supply-info         GET https://api.verathos.ai/v1/supply/info
//     -> {"circulating":0.0,"total":21000000.0,...,"netuid":96,...}
//   sn-96-verathos-protocol-health     GET https://verathos.ai/api/health
//     -> {"status":"ok","mode":"proxy"}
//   sn-96-verathos-models-status       GET https://verathos.ai/api/models/status
//     -> {"loaded":true,"preset_id":"qwen3.5-9b",...}
//   sn-96-verathos-capacity-audit-health GET https://api.verathos.ai/capacity/audit/v1/health
//     -> {"status":"ok","service":"verathos-validator-proxy","capacity_audit":true,...}
//   sn-96-verathos-price-quote         GET https://api.verathos.ai/v1/price
//     -> {"model":...,"cost_usd":0.00015,"cost_tao":...}
//
// Omitted deliberately: sn-96-verathos-subnet-api
// (GET https://api.verathos.ai/v1/supply/circulating) returned a persistent
// HTTP 503 "supply data warming up" on 2026-07-21 -- a transient upstream data
// state, not a registry-config defect (the URL and probe match reality), so it
// is not pinned to a good-response fixture here. The two openapi HEAD surfaces
// (verathos.ai/openapi.json, api.verathos.ai/openapi.json) both answered 200
// application/json and are covered by the schema-source assertions, not a JSON
// body pin (HEAD carries no body).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { callSubnetSurface } from "../src/call-subnet-surface.mjs";
import { handleMcpRequest } from "../src/mcp-server.mjs";

const NETUID = 96;

const registry = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../registry/subnets/verathos.json", import.meta.url),
    ),
    "utf8",
  ),
);

const SURFACES = [
  {
    id: "sn-96-verathos-models-api",
    url: "https://api.verathos.ai/v1/models",
    schemaUrl: "https://verathos.ai/openapi.json",
    body: {
      object: "list",
      data: [
        {
          id: "qwen3.5-9b",
          name: "Qwen3.5-9B",
          architecture: "dense",
          total_params_b: 9.0,
          input_usd_per_1m: 0.08,
          output_usd_per_1m: 0.14,
          max_context_len: 262144,
          num_miners: 112,
        },
      ],
    },
    assertBody: (b) => {
      assert.equal(b.object, "list");
      assert.ok(Array.isArray(b.data));
      assert.equal(b.data[0].id, "qwen3.5-9b");
    },
  },
  {
    id: "sn-96-verathos-health",
    url: "https://api.verathos.ai/health",
    body: { status: "ok" },
    assertBody: (b) => {
      assert.equal(b.status, "ok");
    },
  },
  {
    id: "sn-96-verathos-network-stats",
    url: "https://api.verathos.ai/v1/network/stats",
    body: {
      miners: [
        {
          address: "0xccaf1A04C1e85CBbb36Dbac475dAa13a6353d046",
          ss58_address: "5EbbbnWanPgk1iBptNjBpBSkVC3JFHB5JGsMoAXNFJ5UWsE7",
          uid: 39,
          endpoint: "https://195.26.233.89:40395",
          model_id: "cyankiwi/Qwen3.6-27B-AWQ-INT4",
          healthy: true,
        },
      ],
    },
    assertBody: (b) => {
      assert.ok(Array.isArray(b.miners));
      assert.equal(typeof b.miners[0].ss58_address, "string");
      assert.equal(typeof b.miners[0].uid, "number");
    },
  },
  {
    id: "sn-96-verathos-supply-info",
    url: "https://api.verathos.ai/v1/supply/info",
    body: {
      circulating: 0.0,
      total: 21000000.0,
      max: 21000000.0,
      minted_total: 0.0,
      price_tao: 0.0,
      netuid: 96,
    },
    assertBody: (b) => {
      assert.equal(b.netuid, 96);
      assert.equal(b.total, 21000000.0);
      assert.equal(b.max, 21000000.0);
    },
  },
  {
    id: "sn-96-verathos-protocol-health",
    url: "https://verathos.ai/api/health",
    body: { status: "ok", mode: "proxy" },
    assertBody: (b) => {
      assert.equal(b.status, "ok");
      assert.equal(b.mode, "proxy");
    },
  },
  {
    id: "sn-96-verathos-models-status",
    url: "https://verathos.ai/api/models/status",
    body: {
      loaded: true,
      mode: "chain",
      preset_id: "qwen3.5-9b",
      model_name: "Qwen3.5-9B",
      num_layers: 32,
      quant_label: "fp16",
      max_model_len: 262144,
    },
    assertBody: (b) => {
      assert.equal(b.loaded, true);
      assert.equal(b.preset_id, "qwen3.5-9b");
    },
  },
  {
    id: "sn-96-verathos-capacity-audit-health",
    url: "https://api.verathos.ai/capacity/audit/v1/health",
    body: {
      status: "ok",
      service: "verathos-validator-proxy",
      capacity_audit: true,
      backend_status: 200,
      backend_service: "verathos-capacity-audit-ingest",
    },
    assertBody: (b) => {
      assert.equal(b.status, "ok");
      assert.equal(b.service, "verathos-validator-proxy");
      assert.equal(b.capacity_audit, true);
    },
  },
  {
    id: "sn-96-verathos-price-quote",
    url: "https://api.verathos.ai/v1/price",
    body: {
      model: "qwen2.5-7b-instruct",
      input_tokens: 1000,
      output_tokens: 500,
      cost_usd: 0.00015,
      cost_tao: 7.616532954199248e-7,
      tao_usd: 196.94,
    },
    assertBody: (b) => {
      assert.equal(b.model, "qwen2.5-7b-instruct");
      assert.equal(typeof b.cost_usd, "number");
      assert.equal(typeof b.cost_tao, "number");
    },
  },
];

function surfaceOf(id) {
  return registry.surfaces.find((surface) => surface.id === id);
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("SN96 Verathos call_subnet_surface verification (#7108)", () => {
  for (const fixture of SURFACES) {
    test(`${fixture.id}: registry surface is callable`, () => {
      const surface = surfaceOf(fixture.id);
      assert.ok(surface, `registry surface ${fixture.id} is present`);
      assert.equal(surface.kind, "subnet-api");
      assert.equal(surface.auth_required, false);
      assert.equal(surface.probe?.enabled, true);
      assert.equal(surface.probe?.method, "GET");
      assert.equal(surface.probe?.expect, "json");
      assert.equal(surface.url, fixture.url);
      assert.equal(surface.schema_url, fixture.schemaUrl);
    });

    test(`${fixture.id}: callSubnetSurface returns the real JSON body`, async () => {
      const surface = surfaceOf(fixture.id);
      let requestedUrl;
      let requestedMethod;
      const result = await callSubnetSurface(surface, {
        isUnsafeUrl: async () => false,
        fetchImpl: async (url, init) => {
          requestedUrl = String(url);
          requestedMethod = init.method;
          return jsonResponse(fixture.body);
        },
      });
      assert.equal(result.ok, true);
      assert.equal(requestedUrl, surface.url);
      assert.equal(requestedMethod, "GET");
      assert.equal(result.status_code, 200);
      assert.equal(result.truncated, false);
      fixture.assertBody(result.body);
    });

    test(`${fixture.id}: end-to-end MCP tools/call by surface id`, async () => {
      const surface = surfaceOf(fixture.id);
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
        if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
          return new Response(JSON.stringify({ Status: 0 }), {
            headers: { "content-type": "application/dns-json" },
          });
        }
        return jsonResponse(fixture.body);
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
                arguments: { surface_id: fixture.id },
              },
            }),
          }),
          {},
          deps,
        );
        const result = (await response.json()).result;
        assert.equal(result.isError, false);
        assert.equal(result.structuredContent.surface_id, fixture.id);
        assert.equal(result.structuredContent.status_code, 200);
        fixture.assertBody(result.structuredContent.body);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});
