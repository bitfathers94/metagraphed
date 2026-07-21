// SN110 (Green Compute) end-to-end verification for the call_subnet_surface
// MCP tool (metagraphed#7121, MCP execute Phase 1 follow-up #7014/#7215).
// Unlike tests/call-subnet-surface-mcp.test.mjs -- which proves the tool
// wiring with synthetic surfaces -- this file pins SN110's *real* registry
// surface configs (registry/subnets/green-compute.json) to the tool's
// contract, so a future edit that regresses their callability (flipping a
// GET to HEAD, marking one auth_required, disabling a probe) is caught here.
//
// The Green Compute gateway surfaces listed in #7121 were verified live on
// 2026-07-21 against their exact catalogued URLs on api.green-compute.com:
//   healthz              GET  /healthz                       -> HTTP 200 application/json
//                        {"status":"ok","service":"greencompute-gateway"}
//                        (HEAD /healthz returns 405, so the GET probe is correct)
//   readyz               GET  /readyz                        -> HTTP 200 application/json
//                        {"status":"ok","service":"greencompute-gateway","database":"ok"}
//   billing/bonus-rates  GET  /platform/billing/bonus-rates  -> HTTP 200 application/json
//                        {"stripe":"+0%","usdt":"+0%","usdc":"+0%","tao":"+0%","alpha":"+10%"}
//   metrics              GET  /_metrics                       -> HTTP 200 text/plain (Prometheus),
//                        ~1.7 KB of gateway gauges/counters
//   openapi              HEAD /openapi.json                   -> HTTP 200 application/json (empty body);
//                        a GET returns the ~116 KB OpenAPI 3.1 document
//   chat-completions     POST /v1/chat/completions           -> auth_required custom, probe disabled
// The fixtures below mirror each live response's shape rather than fetching
// it, keeping the test hermetic while still exercising the JSON
// parse-and-return, non-JSON text, HEAD-empty-body, and
// auth_required-rejection paths against each upstream's actual behavior.
// (Bonus rates and metrics are live data, so the tests assert the stable
// shape, not exact contents.)
//
// Note on sn-110-green-compute-openapi: kind "openapi" is not in
// OPERATIONAL_SURFACE_KINDS (src/health-probe-core.mjs), so that surface is
// absent from public/metagraph/operational-surfaces.json and cannot be
// resolved through the call_subnet_surface tool in production. Per the issue,
// a direct request to the URL is equally valid verification for a no-auth
// surface, so it is pinned here at the callSubnetSurface module level only --
// no MCP-tool-path test fakes a catalog entry production does not have.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { callSubnetSurface } from "../src/call-subnet-surface.mjs";
import { OPERATIONAL_SURFACE_KINDS } from "../src/health-probe-core.mjs";
import { handleMcpRequest } from "../src/mcp-server.mjs";

const NETUID = 110;

const registry = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../registry/subnets/green-compute.json", import.meta.url),
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

describe("SN110 Green Compute call_subnet_surface verification (#7121)", () => {
  describe("sn-110-green-compute-healthz", () => {
    const SURFACE = surfaceOf("sn-110-green-compute-healthz");
    // Faithful copy of the live /healthz liveness body.
    const BODY = { status: "ok", service: "greencompute-gateway" };

    test("registry surface exists and is configured to be callable", () => {
      assert.ok(
        SURFACE,
        "registry surface sn-110-green-compute-healthz is present",
      );
      assert.equal(SURFACE.kind, "subnet-api");
      assert.equal(SURFACE.auth_required, false);
      assert.equal(SURFACE.probe?.enabled, true);
      // HEAD /healthz returns 405, so the GET probe is the correct method.
      assert.equal(SURFACE.probe?.method, "GET");
      assert.equal(SURFACE.probe?.expect, "json");
      assert.equal(SURFACE.url, "https://api.green-compute.com/healthz");
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
          return jsonResponse(BODY);
        },
      });
      assert.equal(result.ok, true);
      assert.equal(requestedUrl, SURFACE.url);
      assert.equal(requestedMethod, "GET");
      assert.equal(result.status_code, 200);
      assert.equal(result.content_type, "application/json");
      assert.equal(result.truncated, false);
      assert.equal(result.body.status, "ok");
      assert.equal(result.body.service, "greencompute-gateway");
    });

    test("end-to-end through the call_subnet_surface MCP tool, resolved by surface id", async () => {
      const result = await callToolWithSurface(SURFACE, () =>
        jsonResponse(BODY),
      );
      assert.equal(result.isError, false);
      assert.equal(
        result.structuredContent.surface_id,
        "sn-110-green-compute-healthz",
      );
      assert.equal(result.structuredContent.status_code, 200);
      assert.equal(result.structuredContent.body.status, "ok");
    });
  });

  describe("sn-110-green-compute-readyz", () => {
    const SURFACE = surfaceOf("sn-110-green-compute-readyz");
    // Faithful copy of the live /readyz readiness body (includes DB status).
    const BODY = {
      status: "ok",
      service: "greencompute-gateway",
      database: "ok",
    };

    test("registry surface exists and is configured to be callable", () => {
      assert.ok(
        SURFACE,
        "registry surface sn-110-green-compute-readyz is present",
      );
      assert.equal(SURFACE.kind, "subnet-api");
      assert.equal(SURFACE.auth_required, false);
      assert.equal(SURFACE.probe?.enabled, true);
      assert.equal(SURFACE.probe?.method, "GET");
      assert.equal(SURFACE.probe?.expect, "json");
      assert.equal(SURFACE.url, "https://api.green-compute.com/readyz");
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
          return jsonResponse(BODY);
        },
      });
      assert.equal(result.ok, true);
      assert.equal(requestedUrl, SURFACE.url);
      assert.equal(requestedMethod, "GET");
      assert.equal(result.status_code, 200);
      assert.equal(result.content_type, "application/json");
      assert.equal(result.truncated, false);
      assert.equal(result.body.status, "ok");
      assert.equal(result.body.database, "ok");
    });

    test("end-to-end through the call_subnet_surface MCP tool, resolved by surface id", async () => {
      const result = await callToolWithSurface(SURFACE, () =>
        jsonResponse(BODY),
      );
      assert.equal(result.isError, false);
      assert.equal(
        result.structuredContent.surface_id,
        "sn-110-green-compute-readyz",
      );
      assert.equal(result.structuredContent.status_code, 200);
      assert.equal(result.structuredContent.body.database, "ok");
    });
  });

  describe("sn-110-green-compute-billing-bonus-rates-api", () => {
    const SURFACE = surfaceOf("sn-110-green-compute-billing-bonus-rates-api");
    // Faithful copy of the live /platform/billing/bonus-rates body.
    const BODY = {
      stripe: "+0%",
      usdt: "+0%",
      usdc: "+0%",
      tao: "+0%",
      alpha: "+10%",
    };

    test("registry surface exists and is configured to be callable", () => {
      assert.ok(
        SURFACE,
        "registry surface sn-110-green-compute-billing-bonus-rates-api is present",
      );
      assert.equal(SURFACE.kind, "subnet-api");
      assert.equal(SURFACE.auth_required, false);
      assert.equal(SURFACE.probe?.enabled, true);
      assert.equal(SURFACE.probe?.method, "GET");
      assert.equal(SURFACE.probe?.expect, "json");
      assert.equal(
        SURFACE.url,
        "https://api.green-compute.com/platform/billing/bonus-rates",
      );
      assert.equal(SURFACE.schema_url, undefined);
    });

    test("callSubnetSurface returns the real bonus-rates JSON using the surface's own url + GET", async () => {
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
      assert.equal(result.content_type, "application/json");
      assert.equal(result.truncated, false);
      // Live rates -- assert the stable per-method string shape, not values.
      assert.equal(typeof result.body.stripe, "string");
      assert.equal(typeof result.body.alpha, "string");
    });

    test("end-to-end through the call_subnet_surface MCP tool, resolved by surface id", async () => {
      const result = await callToolWithSurface(SURFACE, () =>
        jsonResponse(BODY),
      );
      assert.equal(result.isError, false);
      assert.equal(
        result.structuredContent.surface_id,
        "sn-110-green-compute-billing-bonus-rates-api",
      );
      assert.equal(result.structuredContent.status_code, 200);
      assert.equal(typeof result.structuredContent.body.alpha, "string");
    });
  });

  describe("sn-110-green-compute-metrics (Prometheus text)", () => {
    const SURFACE = surfaceOf("sn-110-green-compute-metrics");
    // The live /_metrics returns Prometheus text exposition, not JSON.
    const LIVE_TEXT = [
      "# HELP greencompute_service_info Static service information",
      "# TYPE greencompute_service_info gauge",
      'greencompute_service_info{service="greencompute-gateway"} 1',
    ].join("\n");

    function metricsResponse() {
      return new Response(LIVE_TEXT, {
        status: 200,
        headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
      });
    }

    test("registry surface exists and is configured to be callable", () => {
      assert.ok(
        SURFACE,
        "registry surface sn-110-green-compute-metrics is present",
      );
      assert.equal(SURFACE.kind, "data-artifact");
      assert.equal(SURFACE.auth_required, false);
      assert.equal(SURFACE.probe?.enabled, true);
      assert.equal(SURFACE.probe?.method, "GET");
      // Body is Prometheus text/plain, so the "any" expectation is deliberate
      // -- pin it so nobody "fixes" it to json and breaks probes.
      assert.equal(SURFACE.probe?.expect, "any");
      assert.equal(SURFACE.url, "https://api.green-compute.com/_metrics");
    });

    test("callSubnetSurface returns the Prometheus body uncapped and unparsed", async () => {
      let requestedUrl;
      let requestedMethod;
      const result = await callSubnetSurface(SURFACE, {
        isUnsafeUrl: async () => false,
        fetchImpl: async (url, init) => {
          requestedUrl = String(url);
          requestedMethod = init.method;
          return metricsResponse();
        },
      });
      assert.equal(result.ok, true);
      assert.equal(requestedUrl, SURFACE.url);
      assert.equal(requestedMethod, "GET");
      assert.equal(result.status_code, 200);
      assert.equal(result.truncated, false);
      // Text path: returned as the raw string, no JSON parse attempted.
      assert.equal(result.body, LIVE_TEXT);
      assert.equal(result.parse_error, undefined);
    });

    test("data-artifact is an operational kind, so it resolves through the MCP tool", async () => {
      assert.ok(OPERATIONAL_SURFACE_KINDS.includes("data-artifact"));
      const result = await callToolWithSurface(SURFACE, metricsResponse);
      assert.equal(result.isError, false);
      assert.equal(
        result.structuredContent.surface_id,
        "sn-110-green-compute-metrics",
      );
      assert.equal(result.structuredContent.status_code, 200);
      assert.equal(result.structuredContent.body, LIVE_TEXT);
    });
  });

  describe("sn-110-green-compute-openapi (direct-call only)", () => {
    const SURFACE = surfaceOf("sn-110-green-compute-openapi");

    test("registry surface exists, is no-auth, and carries its captured schema", () => {
      assert.ok(
        SURFACE,
        "registry surface sn-110-green-compute-openapi is present",
      );
      assert.equal(SURFACE.kind, "openapi");
      assert.equal(SURFACE.auth_required, false);
      assert.equal(SURFACE.probe?.enabled, true);
      // The surface deliberately uses a HEAD probe: the document is captured
      // for schema-shape metadata only, so recurring probes don't pull 116 KB.
      assert.equal(SURFACE.probe?.method, "HEAD");
      assert.equal(SURFACE.url, "https://api.green-compute.com/openapi.json");
      assert.equal(SURFACE.schema_status, "machine-readable");
      assert.equal(
        SURFACE.schema_url,
        "https://api.green-compute.com/openapi.json",
      );
    });

    test('kind "openapi" is not an operational kind, so this surface is direct-call verified', () => {
      // Documents WHY there is no MCP-tool-path test for this surface: the
      // operational catalog the tool resolves from only includes these kinds.
      assert.ok(!OPERATIONAL_SURFACE_KINDS.includes("openapi"));
      assert.ok(OPERATIONAL_SURFACE_KINDS.includes("subnet-api"));
    });

    test("callSubnetSurface issues the HEAD probe and returns an empty body at 200", async () => {
      let requestedUrl;
      let requestedMethod;
      const result = await callSubnetSurface(SURFACE, {
        isUnsafeUrl: async () => false,
        fetchImpl: async (url, init) => {
          requestedUrl = String(url);
          requestedMethod = init.method;
          // Live HEAD /openapi.json: 200 application/json with no body.
          return new Response("", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      });
      assert.equal(result.ok, true);
      assert.equal(requestedUrl, SURFACE.url);
      assert.equal(requestedMethod, "HEAD");
      assert.equal(result.status_code, 200);
      assert.equal(result.content_type, "application/json");
      assert.equal(result.truncated, false);
      // HEAD response carries no body.
      assert.equal(result.body, "");
    });
  });

  describe("sn-110-green-compute-chat-completions-api (auth required -- Phase 3 territory)", () => {
    const SURFACE = surfaceOf("sn-110-green-compute-chat-completions-api");

    test("registry surface exists and correctly declares custom auth with probes disabled", () => {
      assert.ok(
        SURFACE,
        "registry surface sn-110-green-compute-chat-completions-api is present",
      );
      assert.equal(SURFACE.kind, "subnet-api");
      assert.equal(SURFACE.auth_required, true);
      assert.equal(SURFACE.auth?.scheme, "custom");
      // POST-only chat endpoint: it carries no probe block at all, so recurring
      // reads never run. Pin that it's absent (undefined), not merely disabled.
      assert.equal(SURFACE.probe, undefined);
      assert.equal(
        SURFACE.url,
        "https://api.green-compute.com/v1/chat/completions",
      );
    });

    test("the call_subnet_surface MCP tool rejects it outright without fetching upstream", async () => {
      // In production this surface never even reaches the auth gate: the
      // operational catalog filters out surfaces without an enabled probe, so
      // the tool answers not_found. This test injects the real registry config
      // into a catalog fixture to pin the earlier line of defense: even if it
      // were resolvable, auth_required:true blocks the call before any fetch.
      let upstreamFetched = false;
      const result = await callToolWithSurface(SURFACE, () => {
        upstreamFetched = true;
        return jsonResponse({});
      });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /auth_required/);
      assert.equal(upstreamFetched, false);
    });
  });
});
