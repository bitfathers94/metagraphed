// SN8 (Vanta) end-to-end verification for the call_subnet_surface MCP tool
// (metagraphed#7024, MCP execute Phase 1 follow-up #7014/#7215). Unlike
// tests/call-subnet-surface-mcp.test.mjs -- which proves the tool wiring with
// synthetic surfaces -- this file pins SN8's *real* no-auth GET registry
// surface (registry/subnets/vanta.json) to the tool's contract, so a future
// edit that regresses its callability (flipping to HEAD, marking it
// auth_required, disabling its probe, moving the URL) is caught here.
//
// The surface is the public no-auth scoring-model-parameters file
// (sn-8-vanta-model-parameters, GET
// https://github.com/taoshidev/vanta-network/raw/main/vali_objects/utils/model_parameters/all_model_parameters.json,
// single fixed endpoint -- no schema). Live-verified 2026-07-21: the `raw`
// URL 302-redirects to raw.githubusercontent.com (which callSubnetSurface's
// own manual redirect handling follows, re-checking the safety guard on the
// hop), resolving to HTTP 200 with content-type `text/plain; charset=utf-8`
// and a 20619-byte JSON body of per-asset buy/sell slippage model parameters
// keyed under `equity` (AAPL, NVDA, TSLA, AMZN, GOOG, META, MSFT). Because
// GitHub raw serves the file as text/plain rather than application/json,
// classifyContentType() treats it as `text` and callSubnetSurface returns the
// body verbatim as a string (not a parsed object) -- that's the tool behaving
// correctly for a text/* content-type, not a probe-config defect. The
// surface's kind, auth, and probe method all correctly match how it behaves,
// so no registry change is warranted; this test just pins that current-good
// behavior. The fixture below mirrors that live (redirect-resolved,
// text/plain) response with a representative slice of the real body rather
// than fetching it, keeping the test hermetic while still exercising the
// text-passthrough path.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { callSubnetSurface } from "../src/call-subnet-surface.mjs";
import { handleMcpRequest } from "../src/mcp-server.mjs";

const NETUID = 8;
const SURFACE_ID = "sn-8-vanta-model-parameters";

const registry = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../registry/subnets/vanta.json", import.meta.url)),
    "utf8",
  ),
);
const SURFACE = registry.surfaces.find((surface) => surface.id === SURFACE_ID);

// A representative slice of the live (redirect-resolved) response: the real
// body carries every `equity` asset (AAPL, NVDA, TSLA, AMZN, GOOG, META, MSFT)
// with the same five buy/sell order-size tiers and coefficient shape shown for
// AAPL here.
const BODY = {
  equity: {
    AAPL: {
      buy: {
        "1k_10k": {
          intercept: -6.0712694564057e-6,
          "spread/price": 0.5339598003773119,
          annualized_vol: 2.5430092129633873e-5,
          "buy_order_size/adv": 3.2677497013948282,
        },
      },
      sell: {
        "1k_10k": {
          intercept: -7.437253287824462e-6,
          "spread/price": 0.5679064306749011,
          annualized_vol: 1.902425783077831e-5,
          "sell_order_size/adv": 3.334238640597728,
        },
      },
    },
  },
};

// GitHub raw serves the file as text/plain, so the upstream body is the raw
// JSON text and the tool returns it verbatim as a string.
const BODY_TEXT = JSON.stringify(BODY);

function textResponse() {
  return new Response(BODY_TEXT, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

describe("SN8 Vanta call_subnet_surface verification (#7024)", () => {
  test("the registry surface exists and is configured to be callable", () => {
    assert.ok(SURFACE, `registry surface ${SURFACE_ID} is present`);
    assert.equal(SURFACE.kind, "subnet-api");
    assert.equal(SURFACE.auth_required, false);
    assert.equal(SURFACE.probe?.enabled, true);
    assert.equal(SURFACE.probe?.method, "GET");
    assert.equal(
      SURFACE.url,
      "https://github.com/taoshidev/vanta-network/raw/main/vali_objects/utils/model_parameters/all_model_parameters.json",
    );
    assert.equal(SURFACE.schema_url, undefined);
  });

  test("callSubnetSurface returns the real text body using the surface's own url + GET", async () => {
    let requestedUrl;
    let requestedMethod;
    const result = await callSubnetSurface(SURFACE, {
      isUnsafeUrl: async () => false,
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        requestedMethod = init.method;
        return textResponse();
      },
    });
    assert.equal(result.ok, true);
    assert.equal(requestedUrl, SURFACE.url);
    assert.equal(requestedMethod, "GET");
    assert.equal(result.status_code, 200);
    assert.equal(result.content_type, "text/plain; charset=utf-8");
    assert.equal(result.truncated, false);
    // text/* content is returned verbatim as a string, not a parsed object.
    assert.equal(typeof result.body, "string");
    assert.equal(result.body, BODY_TEXT);
    const parsed = JSON.parse(result.body);
    assert.deepEqual(parsed, BODY);
    assert.equal(
      parsed.equity.AAPL.buy["1k_10k"]["spread/price"],
      0.5339598003773119,
    );
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
      const url = String(input);
      if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
        return new Response(JSON.stringify({ Status: 0 }), {
          headers: { "content-type": "application/dns-json" },
        });
      }
      return textResponse();
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
      assert.equal(result.structuredContent.body, BODY_TEXT);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
