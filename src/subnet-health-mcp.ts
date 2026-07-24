// Per-subnet health list loader for MCP parity on
// GET /api/v1/subnets/{netuid}/health. Applies the same list-query
// transforms as the REST route over the live 15-minute cron health snapshot
// (health is live-only: there is no static artifact to fall back to, so an
// unavailable snapshot serves an explicit empty `unknown` surface list).

import { applyQueryFilters, type Row } from "../workers/list-query.ts";
import { overlaySubnetHealth, resolveLiveHealth } from "./health-serving.ts";
import { API_QUERY_COLLECTIONS, QUERY_ENUMS } from "./contracts.ts";

const HEALTH_SORT_FIELDS = API_QUERY_COLLECTIONS["health-surfaces"].sort_fields;
const SURFACE_KINDS = QUERY_ENUMS.surfaceKind;
const HEALTH_STATUSES = QUERY_ENUMS.healthStatus;
const HEALTH_CLASSIFICATIONS = QUERY_ENUMS.healthClassification;
const SUBNET_HEALTH_QUERY_FILTER_NAMES = [
  "classification",
  "kind",
  "provider",
  "status",
];

export interface SubnetHealthMcpError extends Error {
  toolError: true;
  code: string;
}

export function subnetHealthMcpError(
  code: string,
  message: string,
): SubnetHealthMcpError {
  const error = new Error(message) as SubnetHealthMcpError;
  error.toolError = true;
  error.code = code;
  return error;
}

function requireNetuid(
  args: Record<string, unknown> | null | undefined,
): number {
  const netuid = args?.netuid;
  if (typeof netuid !== "number" || !Number.isInteger(netuid) || netuid < 0) {
    throw subnetHealthMcpError(
      "invalid_params",
      "netuid must be a non-negative integer.",
    );
  }
  return netuid;
}

function optionalString(
  args: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = args?.[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw subnetHealthMcpError(
      "invalid_params",
      `Argument \`${key}\` must be a non-empty string when provided.`,
    );
  }
  return value.trim();
}

function optionalEnum(
  args: Record<string, unknown> | null | undefined,
  key: string,
  allowed: string[],
): string | null {
  const value = args?.[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw subnetHealthMcpError(
      "invalid_params",
      `Argument \`${key}\` must be one of: ${allowed.join(", ")}.`,
    );
  }
  return value;
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number") return fallback;
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(max, Math.floor(value));
}

export function subnetHealthQueryUrl(
  args: Record<string, unknown> | null | undefined,
): URL {
  const url = new URL("https://mcp.internal/subnets/health");
  requireNetuid(args);
  const kind = optionalEnum(args, "kind", SURFACE_KINDS);
  if (kind) url.searchParams.set("kind", kind);
  const provider = optionalString(args, "provider");
  if (provider) url.searchParams.set("provider", provider);
  const status = optionalEnum(args, "status", HEALTH_STATUSES);
  if (status) url.searchParams.set("status", status);
  const classification = optionalEnum(
    args,
    "classification",
    HEALTH_CLASSIFICATIONS,
  );
  if (classification) url.searchParams.set("classification", classification);
  const sort = optionalEnum(args, "sort", HEALTH_SORT_FIELDS);
  if (sort) url.searchParams.set("sort", sort);
  const order = optionalEnum(args, "order", ["asc", "desc"]);
  if (order) url.searchParams.set("order", order);
  if (args?.limit !== undefined) {
    url.searchParams.set("limit", String(clampLimit(args.limit, 50, 100)));
  }
  if (args?.cursor !== undefined) {
    const cursor = args.cursor;
    if (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 0) {
      throw subnetHealthMcpError(
        "invalid_params",
        "cursor must be a non-negative integer.",
      );
    }
    url.searchParams.set("cursor", String(cursor));
  }
  return url;
}

function unknownSubnetHealthBlob(netuid: number): Row {
  return {
    schema_version: 1,
    netuid,
    generated_at: null,
    surfaces: [],
  };
}

export interface SubnetHealthListResult {
  generated_at: unknown;
  netuid: unknown;
  surfaces: Row[];
  total: unknown;
  returned: unknown;
  limit: unknown;
  cursor: unknown;
  next_cursor: unknown;
  sort: unknown;
  order: unknown;
}

export async function loadSubnetHealthList(
  ctx: {
    env: Env;
    readHealthKv?: (env: Env, key: string) => Promise<Row | null>;
  },
  args: Record<string, unknown> | null | undefined,
  {
    resolveLive,
  }: {
    resolveLive?: (ctx: { env: Env }) => Promise<Row | null>;
  } = {},
): Promise<SubnetHealthListResult> {
  const netuid = requireNetuid(args);
  const queryUrl = subnetHealthQueryUrl(args);
  const resolve =
    resolveLive ??
    (() => resolveLiveHealth({ readHealthKv: ctx.readHealthKv, env: ctx.env }));
  const live = await resolve(ctx);
  const blob =
    overlaySubnetHealth(null, live, netuid) ?? unknownSubnetHealthBlob(netuid);
  const transformed = applyQueryFilters(
    blob,
    queryUrl,
    "health-surfaces",
    SUBNET_HEALTH_QUERY_FILTER_NAMES,
  );
  if (transformed.error) {
    throw subnetHealthMcpError("invalid_params", transformed.error.message);
  }
  const data = transformed.data as Record<string, unknown>;
  const meta = transformed.meta as Record<string, unknown>;
  const page = (meta.pagination as Record<string, unknown>) || {};
  const rows = Array.isArray(data.surfaces) ? (data.surfaces as Row[]) : [];
  const rowLen = rows.length;
  return {
    generated_at: data.generated_at ?? null,
    netuid: data.netuid ?? netuid,
    surfaces: rows,
    total: page.total ?? rowLen,
    returned: page.returned ?? rowLen,
    limit: page.limit ?? rowLen,
    cursor: page.cursor ?? 0,
    next_cursor: page.next_cursor ?? null,
    sort: page.sort ?? null,
    order: page.order ?? null,
  };
}

export const LIST_SUBNET_HEALTH_INSTRUCTIONS =
  "list_subnet_health one subnet's live health surfaces with REST list-query " +
  "filters (kind, provider, status, classification, and pagination; mirrors " +
  "GET /api/v1/subnets/{netuid}/health), ";

export const LIST_SUBNET_HEALTH_MCP_TOOL = {
  name: "list_subnet_health",
  title: "List one subnet's health surfaces",
  description:
    "Fetch live per-surface operational health for one subnet by netuid " +
    "(probed every ~15 minutes): each surface with kind, provider, status, " +
    "classification, latency, and last-checked/last-ok timestamps. Filter by " +
    "kind, provider, status, or classification; sort with sort + order; and " +
    "page with limit (1-100) / cursor. Distinct from get_subnet_health (the " +
    "full unfiltered snapshot with reliability). Mirrors " +
    "GET /api/v1/subnets/{netuid}/health.",
  inputSchema: {
    type: "object",
    properties: {
      netuid: {
        type: "integer",
        description: "Subnet netuid.",
        minimum: 0,
      },
      kind: {
        type: "string",
        enum: SURFACE_KINDS,
        description: "Filter by surface kind, e.g. 'subnet-api'.",
      },
      provider: {
        type: "string",
        description: "Filter by provider slug.",
      },
      status: {
        type: "string",
        enum: HEALTH_STATUSES,
        description: "Filter by probe-derived health status.",
      },
      classification: {
        type: "string",
        enum: HEALTH_CLASSIFICATIONS,
        description: "Filter by probe outcome classification.",
      },
      sort: {
        type: "string",
        enum: HEALTH_SORT_FIELDS,
        description: "Field to sort by before paging.",
      },
      order: {
        type: "string",
        enum: ["asc", "desc"],
        description: "Sort direction for sort (default asc).",
      },
      limit: {
        type: "integer",
        description: "Max rows to return (1-100). Enables pagination.",
        minimum: 1,
        maximum: 100,
      },
      cursor: {
        type: "integer",
        description: "Pagination cursor from a prior response's next_cursor.",
        minimum: 0,
      },
    },
    required: ["netuid"],
    additionalProperties: false,
  },
};

const NULLABLE_STRING = { type: ["string", "null"] };
const NULLABLE_INT = { type: ["integer", "null"] };

export const LIST_SUBNET_HEALTH_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  required: ["surfaces"],
  properties: {
    generated_at: NULLABLE_STRING,
    netuid: NULLABLE_INT,
    surfaces: { type: "array", items: { type: "object" } },
    total: { type: "integer" },
    returned: { type: "integer" },
    limit: { type: "integer" },
    cursor: { type: "integer" },
    next_cursor: NULLABLE_INT,
    sort: NULLABLE_STRING,
    order: NULLABLE_STRING,
  },
};
