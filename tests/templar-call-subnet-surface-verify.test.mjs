// SN3 (Templar) end-to-end verification for the call_subnet_surface MCP tool
// (metagraphed#7019, MCP execute Phase 1 follow-up #7014/#7215). Unlike
// tests/call-subnet-surface-mcp.test.mjs -- which proves the tool wiring with
// synthetic surfaces -- this file pins SN3's *real* registry surface config
// (registry/subnets/templar.json) to the tool's contract, so a future edit that
// breaks the tool's assumptions about these surfaces trips a red test.
//
// Live-verified 2026-07-21 (exact requests the tool makes):
//   sn-3-templar-health  GET https://grafana.tplr.ai/api/health
//     -> 200 application/json  {"database":"ok"}
//   sn-3-templar-grafana-openapi  GET https://grafana.tplr.ai/public/openapi3.json
//     -> 200 application/json  OpenAPI 3.0.3, title "Grafana HTTP API.", 208 paths (~728 KB)
//
// Two behaviours worth pinning that come straight from those live calls:
//   1. sn-3-templar-health carries NO probe block, so callSubnetSurface falls
//      back to its GET default -- which is exactly the method /api/health wants.
//      The surface is callable as-is; it does not need a probe block added.
//   2. The openapi body is ~728 KB, well above MAX_RESPONSE_BYTES (256 KB), so
//      the tool caps it and returns truncated=true with the partial (unparsed)
//      text rather than failing -- a truncated spec is still useful to an agent.
// The openapi surface's kind ("openapi") is not in OPERATIONAL_SURFACE_KINDS, so
// it is verified via a direct callSubnetSurface call; only the subnet-api health
// surface is resolvable through the MCP tool's operational-surfaces catalog.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import {
  callSubnetSurface,
  MAX_RESPONSE_BYTES,
} from "../src/call-subnet-surface.mjs";
import { handleMcpRequest } from "../src/mcp-server.mjs";

const HEALTH_ID = "sn-3-templar-health";
const OPENAPI_ID = "sn-3-templar-grafana-openapi";
const NETUID = 3;

const registry = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../registry/subnets/templar.json", import.meta.url)),
    "utf8",
  ),
);
const HEALTH = registry.surfaces.find((surface) => surface.id === HEALTH_ID);
const OPENAPI = registry.surfaces.find((surface) => surface.id === OPENAPI_ID);

const HEALTH_BODY = { database: "ok" };
const OPENAPI_BODY = {
  openapi: "3.0.3",
  info: { title: "Grafana HTTP API.", version: "0.0.1" },
  paths: { "/api/org": {}, "/api/search": {} },
};

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("SN3 Templar call_subnet_surface verification (#7019)", () => {
  test("the health registry surface is a no-auth callable subnet-api", () => {
    assert.ok(HEALTH, `registry surface ${HEALTH_ID} is present`);
    assert.equal(HEALTH.kind, "subnet-api");
    assert.equal(HEALTH.auth_required, false);
    assert.equal(HEALTH.url, "https://grafana.tplr.ai/api/health");
    // No probe block: the tool defaults to GET, which is correct here.
    assert.equal(HEALTH.probe, undefined);
    assert.equal(HEALTH.schema_url, undefined);
  });

  test("the openapi registry surface is a no-auth GET-json schema surface", () => {
    assert.ok(OPENAPI, `registry surface ${OPENAPI_ID} is present`);
    assert.equal(OPENAPI.kind, "openapi");
    assert.equal(OPENAPI.auth_required, false);
    assert.equal(OPENAPI.probe?.enabled, true);
    assert.equal(OPENAPI.probe?.method, "GET");
    assert.equal(OPENAPI.probe?.expect, "json");
    assert.equal(OPENAPI.url, "https://grafana.tplr.ai/public/openapi3.json");
    assert.equal(
      OPENAPI.schema_url,
      "https://grafana.tplr.ai/public/openapi3.json",
    );
  });

  test("callSubnetSurface fetches the health JSON via a defaulted GET", async () => {
    let requestedUrl;
    let requestedMethod;
    const result = await callSubnetSurface(HEALTH, {
      isUnsafeUrl: async () => false,
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        requestedMethod = init.method;
        return jsonResponse(HEALTH_BODY);
      },
    });
    assert.equal(result.ok, true);
    assert.equal(requestedUrl, HEALTH.url);
    assert.equal(requestedMethod, "GET");
    assert.equal(result.status_code, 200);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.body, { database: "ok" });
  });

  test("callSubnetSurface fetches and parses the openapi spec via GET", async () => {
    let requestedUrl;
    let requestedMethod;
    const result = await callSubnetSurface(OPENAPI, {
      isUnsafeUrl: async () => false,
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        requestedMethod = init.method;
        return jsonResponse(OPENAPI_BODY);
      },
    });
    assert.equal(result.ok, true);
    assert.equal(requestedUrl, OPENAPI.url);
    assert.equal(requestedMethod, "GET");
    assert.equal(result.status_code, 200);
    assert.equal(result.truncated, false);
    assert.equal(result.body.openapi, "3.0.3");
    assert.equal(result.body.info.title, "Grafana HTTP API.");
  });

  test("an over-cap openapi body is truncated, not parsed, and not fatal", async () => {
    // The live spec is ~728 KB; reproduce the tool's cap with a body just past
    // MAX_RESPONSE_BYTES so the truncated-JSON branch (partial text + parse_error)
    // is exercised exactly as it is against the real URL.
    const oversized = `{"openapi":"3.0.3","pad":"${"x".repeat(MAX_RESPONSE_BYTES)}"}`;
    const result = await callSubnetSurface(OPENAPI, {
      isUnsafeUrl: async () => false,
      fetchImpl: async () =>
        new Response(oversized, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.status_code, 200);
    assert.equal(result.truncated, true);
    assert.equal(typeof result.body, "string");
    assert.ok(result.parse_error, "truncated JSON reports a parse_error");
  });

  test("end-to-end through the MCP tool, resolving the health surface by id", async () => {
    const catalog = {
      surfaces: [{ ...HEALTH, surface_id: HEALTH.id, netuid: NETUID }],
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
      return jsonResponse(HEALTH_BODY);
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
              arguments: { surface_id: HEALTH_ID },
            },
          }),
        }),
        {},
        deps,
      );
      const result = (await response.json()).result;
      assert.equal(result.isError, false);
      assert.equal(result.structuredContent.surface_id, HEALTH_ID);
      assert.equal(result.structuredContent.status_code, 200);
      assert.deepEqual(result.structuredContent.body, { database: "ok" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
