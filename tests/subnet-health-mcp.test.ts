import assert from "node:assert/strict";
import { describe, test, vi } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as listQuery from "../workers/list-query.ts";
import {
  LIST_SUBNET_HEALTH_INSTRUCTIONS,
  LIST_SUBNET_HEALTH_MCP_TOOL,
  LIST_SUBNET_HEALTH_OUTPUT_SCHEMA,
  loadSubnetHealthList,
  subnetHealthMcpError,
  subnetHealthQueryUrl,
} from "../src/subnet-health-mcp.ts";
import type { Row } from "./row-type.ts";

type LoadCtx = Parameters<typeof loadSubnetHealthList>[0];
type LoadDeps = Parameters<typeof loadSubnetHealthList>[2];

import { MCP_INSTRUCTIONS, MCP_TOOLS } from "../src/mcp-server.mjs";

const NETUID = 7;

const SAMPLE_LIVE = {
  last_run_at: "2026-07-01T00:00:00.000Z",
  surfaces: [
    {
      surface_id: "allways-api",
      surface_key: "allways-api",
      netuid: NETUID,
      kind: "subnet-api",
      provider: "allways",
      url: "https://allways.example/api",
      status: "ok",
      classification: "live",
      latency_ms: 120,
      status_code: 200,
      last_checked: "2026-07-01T00:00:00.000Z",
      last_ok: "2026-07-01T00:00:00.000Z",
    },
    {
      surface_id: "allways-openapi",
      surface_key: "allways-openapi",
      netuid: NETUID,
      kind: "openapi",
      provider: "allways",
      url: "https://allways.example/openapi.json",
      status: "degraded",
      classification: "transient",
      latency_ms: 450,
      status_code: 503,
      last_checked: "2026-07-01T00:00:00.000Z",
      last_ok: "2026-06-30T00:00:00.000Z",
    },
  ],
};

function resolveLive() {
  return Promise.resolve(SAMPLE_LIVE);
}

describe("subnet-health-mcp", () => {
  test("subnetHealthMcpError is shaped for MCP toolError handling", () => {
    const err = subnetHealthMcpError("invalid_params", "bad kind");
    assert.equal(err.code, "invalid_params");
    assert.equal(err.toolError, true);
  });

  test("subnetHealthQueryUrl validates filters and cursor", () => {
    const url = subnetHealthQueryUrl({
      netuid: NETUID,
      kind: "subnet-api",
      provider: "allways",
      status: "ok",
      classification: "live",
      sort: "latency_ms",
      order: "asc",
      limit: 10,
      cursor: 5,
    });
    assert.equal(url.searchParams.get("kind"), "subnet-api");
    assert.equal(url.searchParams.get("provider"), "allways");
    assert.equal(url.searchParams.get("status"), "ok");
    assert.equal(url.searchParams.get("classification"), "live");
    assert.equal(url.searchParams.get("sort"), "latency_ms");
    assert.equal(url.searchParams.get("order"), "asc");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal(url.searchParams.get("cursor"), "5");
  });

  test("subnetHealthQueryUrl rejects missing netuid", () => {
    assert.throws(
      () => subnetHealthQueryUrl({}),
      (err: Row) => err.code === "invalid_params",
    );
  });

  test("subnetHealthQueryUrl rejects invalid kind", () => {
    assert.throws(
      () => subnetHealthQueryUrl({ netuid: NETUID, kind: "bogus" }),
      (err: Row) => err.code === "invalid_params",
    );
  });

  test("subnetHealthQueryUrl rejects invalid status", () => {
    assert.throws(
      () => subnetHealthQueryUrl({ netuid: NETUID, status: "bogus" }),
      (err: Row) => err.code === "invalid_params",
    );
  });

  test("subnetHealthQueryUrl rejects invalid classification", () => {
    assert.throws(
      () => subnetHealthQueryUrl({ netuid: NETUID, classification: "bogus" }),
      (err: Row) => err.code === "invalid_params",
    );
  });

  test("subnetHealthQueryUrl rejects empty provider and invalid sort", () => {
    assert.throws(
      () => subnetHealthQueryUrl({ netuid: NETUID, provider: "   " }),
      (err: Row) => err.code === "invalid_params",
    );
    assert.throws(
      () => subnetHealthQueryUrl({ netuid: NETUID, sort: "not_a_column" }),
      (err: Row) => err.code === "invalid_params",
    );
  });

  test("subnetHealthQueryUrl rejects non-string provider and invalid order", () => {
    assert.throws(
      () => subnetHealthQueryUrl({ netuid: NETUID, provider: 42 }),
      (err: Row) => err.code === "invalid_params",
    );
    assert.throws(
      () => subnetHealthQueryUrl({ netuid: NETUID, order: "sideways" }),
      (err: Row) => err.code === "invalid_params",
    );
  });

  test("subnetHealthQueryUrl clamps a non-numeric limit to the default", () => {
    const url = subnetHealthQueryUrl({ netuid: NETUID, limit: "lots" });
    assert.equal(url.searchParams.get("limit"), "50");
  });

  test("subnetHealthQueryUrl clamps a sub-minimum numeric limit to the default", () => {
    const url = subnetHealthQueryUrl({ netuid: NETUID, limit: 0 });
    assert.equal(url.searchParams.get("limit"), "50");
  });

  test("subnetHealthQueryUrl clamps limit above the MCP maximum", () => {
    const url = subnetHealthQueryUrl({ netuid: NETUID, limit: 500 });
    assert.equal(url.searchParams.get("limit"), "100");
  });

  test("subnetHealthQueryUrl rejects a fractional netuid", () => {
    assert.throws(
      () => subnetHealthQueryUrl({ netuid: 1.5 }),
      (err: Row) => err.code === "invalid_params",
    );
  });

  test("subnetHealthQueryUrl rejects a fractional cursor", () => {
    assert.throws(
      () => subnetHealthQueryUrl({ netuid: NETUID, cursor: 1.5 }),
      (err: Row) => err.code === "invalid_params",
    );
  });

  test("subnetHealthQueryUrl rejects negative cursor", () => {
    assert.throws(
      () => subnetHealthQueryUrl({ netuid: NETUID, cursor: -1 }),
      (err: Row) => err.code === "invalid_params",
    );
  });

  test("loadSubnetHealthList filters by status", async () => {
    const out = await loadSubnetHealthList(
      { env: {} } as unknown as LoadCtx,
      { netuid: NETUID, status: "ok" },
      { resolveLive } as unknown as LoadDeps,
    );
    assert.equal(out.returned, 1);
    assert.equal(out.surfaces[0].surface_id, "allways-api");
    assert.equal(out.netuid, NETUID);
  });

  test("loadSubnetHealthList filters by classification", async () => {
    const out = await loadSubnetHealthList(
      { env: {} } as unknown as LoadCtx,
      { netuid: NETUID, classification: "transient" },
      { resolveLive } as unknown as LoadDeps,
    );
    assert.equal(out.returned, 1);
    assert.equal(out.surfaces[0].surface_id, "allways-openapi");
  });

  test("loadSubnetHealthList sorts and pages the collection", async () => {
    const out = await loadSubnetHealthList(
      { env: {} } as unknown as LoadCtx,
      { netuid: NETUID, sort: "latency_ms", order: "desc", limit: 1 },
      { resolveLive } as unknown as LoadDeps,
    );
    assert.equal(out.returned, 1);
    assert.equal(out.total, 2);
    assert.equal(out.surfaces[0].surface_id, "allways-openapi");
    assert.equal(out.next_cursor, 1);
  });

  test("loadSubnetHealthList serves an empty surface list when the live snapshot is cold", async () => {
    const out = await loadSubnetHealthList(
      { env: {} } as unknown as LoadCtx,
      { netuid: NETUID },
      { resolveLive: async () => null } as unknown as LoadDeps,
    );
    assert.deepEqual(out.surfaces, []);
    assert.equal(out.total, 0);
    assert.equal(out.netuid, NETUID);
  });

  test("loadSubnetHealthList excludes surfaces from other subnets", async () => {
    const out = await loadSubnetHealthList(
      { env: {} } as unknown as LoadCtx,
      { netuid: NETUID + 1 },
      { resolveLive } as unknown as LoadDeps,
    );
    assert.deepEqual(out.surfaces, []);
    assert.equal(out.total, 0);
  });

  test("loadSubnetHealthList rejects invalid list-query params from REST parity", async () => {
    await assert.rejects(
      () =>
        loadSubnetHealthList(
          { env: {} } as unknown as LoadCtx,
          { netuid: NETUID, provider: "x".repeat(200) },
          { resolveLive } as unknown as LoadDeps,
        ),
      (err: Row) => err.code === "invalid_params",
    );
  });

  test("loadSubnetHealthList rejects missing netuid", async () => {
    await assert.rejects(
      () =>
        loadSubnetHealthList({ env: {} } as unknown as LoadCtx, {}, {
          resolveLive,
        } as unknown as LoadDeps),
      (err: Row) => err.code === "invalid_params",
    );
  });

  test("loadSubnetHealthList treats a non-array surfaces key as empty", async () => {
    const spy = vi
      .spyOn(listQuery, "applyQueryFilters")
      .mockReturnValue({ data: { surfaces: null }, meta: {} });
    try {
      const out = await loadSubnetHealthList(
        { env: {} } as unknown as LoadCtx,
        { netuid: NETUID },
        { resolveLive } as unknown as LoadDeps,
      );
      assert.deepEqual(out.surfaces, []);
      assert.equal(out.total, 0);
    } finally {
      spy.mockRestore();
    }
  });

  test("loadSubnetHealthList falls back when pagination meta is absent", async () => {
    const spy = vi.spyOn(listQuery, "applyQueryFilters").mockReturnValue({
      data: { surfaces: [{ netuid: NETUID }, { netuid: NETUID }] },
      meta: {},
    });
    try {
      const out = await loadSubnetHealthList(
        { env: {} } as unknown as LoadCtx,
        { netuid: NETUID },
        { resolveLive } as unknown as LoadDeps,
      );
      assert.equal(out.total, 2);
      assert.equal(out.returned, 2);
      assert.equal(out.limit, 2);
      assert.equal(out.cursor, 0);
      assert.equal(out.next_cursor, null);
      assert.equal(out.sort, null);
      assert.equal(out.order, null);
    } finally {
      spy.mockRestore();
    }
  });

  test("loadSubnetHealthList uses the default live-health resolver when none is injected", async () => {
    const out = await loadSubnetHealthList(
      { env: {}, readHealthKv: async () => null } as unknown as LoadCtx,
      { netuid: NETUID },
    );
    assert.deepEqual(out.surfaces, []);
    assert.equal(out.total, 0);
  });

  test("MCP tool metadata and outputSchema compile", () => {
    assert.equal(LIST_SUBNET_HEALTH_MCP_TOOL.name, "list_subnet_health");
    assert.match(LIST_SUBNET_HEALTH_INSTRUCTIONS, /list_subnet_health/);
    assert.ok(
      new Ajv2020({ strict: false }).compile(LIST_SUBNET_HEALTH_OUTPUT_SCHEMA),
    );
  });

  test("MCP server exports wire list_subnet_health", () => {
    assert.match(MCP_INSTRUCTIONS, /list_subnet_health/);
    const tool = MCP_TOOLS.find((t: Row) => t.name === "list_subnet_health");
    assert.ok(tool);
    assert.equal(tool.title, "List one subnet's health surfaces");
  });
});
