// SN87 (Luminar Network) end-to-end verification for the call_subnet_surface
// MCP tool (metagraphed#7099, MCP execute Phase 1 follow-up #7014/#7215). Unlike
// tests/call-subnet-surface-mcp.test.mjs -- which proves the tool wiring with
// synthetic surfaces -- this file pins SN87's *real* no-auth GET liveness
// surface (registry/subnets/luminar-network.json) to the tool's contract.
//
// Live-verified 2026-07-21:
//   sn-87-luminar-health  GET https://luminar.network/healthz
//     -> HTTP 200 text/plain body "ok" (2 bytes)
//
// The registry entry originally shipped without a probe block, so
// scripts/build-artifacts.mjs (which requires probe.enabled) excluded it from
// operational-surfaces.json and call_subnet_surface could not resolve it. This
// PR adds the probe block (GET, expect any); the end-to-end case below pins
// that the surface is now catalog-resolvable and returns the plain-text body.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { callSubnetSurface } from "../src/call-subnet-surface.mjs";
import { handleMcpRequest } from "../src/mcp-server.mjs";

const NETUID = 87;
const SURFACE_ID = "sn-87-luminar-health";
const SURFACE_URL = "https://luminar.network/healthz";

const registry = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../registry/subnets/luminar-network.json", import.meta.url),
    ),
    "utf8",
  ),
);

function surfaceOf(id) {
  return registry.surfaces.find((surface) => surface.id === id);
}

function textResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

describe("SN87 Luminar Network call_subnet_surface verification (#7099)", () => {
  test(`${SURFACE_ID}: registry surface is wired for the tool`, () => {
    const surface = surfaceOf(SURFACE_ID);
    assert.ok(surface, `registry surface ${SURFACE_ID} is present`);
    assert.equal(surface.kind, "subnet-api");
    assert.equal(surface.auth_required, false);
    assert.equal(surface.public_safe, true);
    // The probe block is what promotes this surface into
    // operational-surfaces.json; without it the tool cannot resolve the id.
    assert.equal(surface.probe?.enabled, true);
    assert.equal(surface.probe?.method, "GET");
    assert.equal(surface.probe?.expect, "any");
    assert.equal(surface.url, SURFACE_URL);
    // No auth and no schema on this single fixed liveness endpoint.
    assert.equal(surface.schema_url, undefined);
  });

  test(`${SURFACE_ID}: callSubnetSurface issues a GET and returns the "ok" body`, async () => {
    const surface = surfaceOf(SURFACE_ID);
    let requestedUrl;
    let requestedMethod;
    const result = await callSubnetSurface(surface, {
      isUnsafeUrl: async () => false,
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        requestedMethod = init.method;
        return textResponse("ok");
      },
    });
    assert.equal(result.ok, true);
    assert.equal(requestedUrl, SURFACE_URL);
    // No probe.method === "HEAD", so the tool defaults to GET.
    assert.equal(requestedMethod, "GET");
    assert.equal(result.status_code, 200);
    assert.equal(result.truncated, false);
    // A text/plain body is returned verbatim (not JSON-parsed).
    assert.equal(result.body, "ok");
  });

  test(`${SURFACE_ID}: end-to-end MCP tools/call by surface id`, async () => {
    const surface = surfaceOf(SURFACE_ID);
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
      return textResponse("ok");
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
              arguments: { surface_id: SURFACE_ID },
            },
          }),
        }),
        {},
        deps,
      );
      const result = (await response.json()).result;
      assert.equal(result.isError, false);
      assert.equal(result.structuredContent.surface_id, SURFACE_ID);
      assert.equal(result.structuredContent.status_code, 200);
      assert.equal(result.structuredContent.body, "ok");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
