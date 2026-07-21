// SN10 (Swap) end-to-end verification for the call_subnet_surface MCP tool
// (metagraphed#7026, MCP execute Phase 1 follow-up #7014/#7215). Like
// tests/sn50-call-subnet-surface-verify.test.mjs, this file pins SN10's *real*
// registry surface configs (registry/subnets/swap.json) to the tool's
// contract, so a future edit that regresses their callability is caught here.
//
// Both surfaces listed in #7026 were verified live on 2026-07-21 against their
// exact catalogued URLs:
//   sn-10-taofi-openapi
//     GET https://taofi-doc.web.app/openapi.yaml
//     -> HTTP 200 text/yaml, OpenAPI 3.0.4 (~44 KB, title "TaoFi - OpenAPI 3.0")
//   sn-10-taofi-api
//     GET https://taofi-api.web.app/ -> HTTP 404 (bare host root)
// Registry already matched reality -- no registry edit needed.
//
// sn-10-taofi-openapi is served as YAML, so callSubnetSurface returns the raw
// text body (classifyContentType -> "text"), not parsed JSON. Its kind
// "openapi" is not in OPERATIONAL_SURFACE_KINDS (src/health-probe-core.mjs), so
// it never appears in operational-surfaces.json and cannot be resolved through
// the tool in production; per #7026 a direct GET is equally valid verification
// for a no-auth surface, so it is pinned here at the callSubnetSurface module
// level only.
//
// sn-10-taofi-api carries probe.enabled:false on purpose: its documented
// endpoints are all POST-only and the bare host root returns 404, neither of
// which the GET/HEAD-only probe can exercise, so no live read is asserted for
// it -- only that its deliberate non-callable config stays intact.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { callSubnetSurface } from "../src/call-subnet-surface.mjs";
import { OPERATIONAL_SURFACE_KINDS } from "../src/health-probe-core.mjs";

const registry = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../registry/subnets/swap.json", import.meta.url)),
    "utf8",
  ),
);

function surfaceOf(id) {
  return registry.surfaces.find((surface) => surface.id === id);
}

function yamlResponse(body) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/yaml; charset=utf-8" },
  });
}

describe("SN10 Swap call_subnet_surface verification (#7026)", () => {
  describe("sn-10-taofi-openapi (direct-call only)", () => {
    const SURFACE = surfaceOf("sn-10-taofi-openapi");
    // Faithful subset of the live openapi.yaml response's leading lines.
    const BODY = [
      "openapi: 3.0.4",
      "info:",
      "  title: TaoFi - OpenAPI 3.0",
      "  version: 1.0.0",
      "paths:",
      "  /getBuyQuote:",
      "    post:",
      "      summary: Get a buy quote",
      "",
    ].join("\n");

    test("registry surface exists, is no-auth GET, and carries its captured schema", () => {
      assert.ok(SURFACE, "registry surface sn-10-taofi-openapi is present");
      assert.equal(SURFACE.kind, "openapi");
      assert.equal(SURFACE.auth_required, false);
      assert.equal(SURFACE.probe?.enabled, true);
      assert.equal(SURFACE.probe?.method, "GET");
      assert.equal(SURFACE.probe?.expect, "any");
      assert.equal(SURFACE.url, "https://taofi-doc.web.app/openapi.yaml");
      assert.equal(SURFACE.schema_status, "machine-readable");
      assert.equal(
        SURFACE.schema_url,
        "https://taofi-doc.web.app/openapi.yaml",
      );
    });

    test('kind "openapi" is not an operational kind, so this surface is direct-call verified', () => {
      assert.ok(!OPERATIONAL_SURFACE_KINDS.includes("openapi"));
      assert.ok(OPERATIONAL_SURFACE_KINDS.includes("subnet-api"));
    });

    test("callSubnetSurface returns the OpenAPI YAML document as a raw text body", async () => {
      let requestedUrl;
      let requestedMethod;
      const result = await callSubnetSurface(SURFACE, {
        isUnsafeUrl: async () => false,
        fetchImpl: async (url, init) => {
          requestedUrl = String(url);
          requestedMethod = init.method;
          return yamlResponse(BODY);
        },
      });
      assert.equal(result.ok, true);
      assert.equal(requestedUrl, SURFACE.url);
      assert.equal(requestedMethod, "GET");
      assert.equal(result.status_code, 200);
      assert.ok(result.content_type.startsWith("text/yaml"));
      assert.equal(result.truncated, false);
      // YAML is not JSON-parsed -- the body is returned verbatim as a string.
      assert.equal(typeof result.body, "string");
      assert.ok(result.body.includes("openapi: 3.0.4"));
      assert.ok(result.body.includes("title: TaoFi - OpenAPI 3.0"));
      assert.equal(result.parse_error, undefined);
    });
  });

  describe("sn-10-taofi-api (deliberately non-callable)", () => {
    const SURFACE = surfaceOf("sn-10-taofi-api");

    test("registry surface exists, is no-auth, and points at the OpenAPI servers host", () => {
      assert.ok(SURFACE, "registry surface sn-10-taofi-api is present");
      assert.equal(SURFACE.kind, "subnet-api");
      assert.equal(SURFACE.auth_required, false);
      assert.equal(SURFACE.url, "https://taofi-api.web.app/");
      assert.equal(
        SURFACE.schema_url,
        "https://taofi-doc.web.app/openapi.yaml",
      );
    });

    test("its read probe is intentionally disabled (POST-only endpoints, root 404)", () => {
      // The documented paths are all POST-only and the bare host root 404s, so
      // the GET/HEAD-only probe would never see a healthy read -- the disabled
      // flag records that, and this pins it so a future PR can't silently
      // re-enable it without the API exposing a GET surface.
      assert.equal(SURFACE.probe?.enabled, false);
      assert.equal(SURFACE.probe?.method, "GET");
    });
  });
});
