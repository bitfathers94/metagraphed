// Zod schemas for the MCP AI-native tool registry (types-epic E, #7863),
// batch 12 (#8076): find_subnet_opportunities, semantic_search, ask,
// find_subnet_for_task, how_do_i_call, verify_integration,
// call_subnet_surface.
//
// Unlike schemas-src/routes/ (which mirrors REST envelopes already
// duplicated from src/contracts.ts's OpenAPI contract), these tools have no
// REST-route counterpart to reuse -- each is an MCP-only shape, so the
// hand-written JSON Schema 2020-12 literals previously inline in
// src/mcp-server.ts's MCP_TOOLS/TOOL_OUTPUT_SCHEMAS are the only source of
// truth being converted here. ECONOMIC_LEADERBOARD_BOARDS/SEMANTIC_TYPES are
// imported (not re-declared) from the same modules mcp-server.ts already
// pulls them from, so the tool schema and the server-side validator can
// never drift -- this file IS imported by mcp-server.ts (a real Worker
// entry), unlike schemas-src/routes/, so importing runtime constants here
// carries no bundling concern that doesn't already exist.
//
// z.toJSONSchema() output vs. the hand-written literals it replaces is
// cosmetically different in ways scripts/diff-mcp-tool-zod-schemas.ts
// normalizes away (redundant int bounds, additionalProperties:{} vs true,
// oneOf vs anyOf, dropped descriptions, missing vs explicit
// additionalProperties:true, items:{} vs an omitted items key) -- see that
// script's own header for the full, structural list.
import { z } from "zod";
import { ECONOMIC_LEADERBOARD_BOARDS } from "../src/health-serving.ts";
import { SEMANTIC_TYPES } from "../src/ai-search.ts";

const AnySchema = z.any();
const NullableString = z.string().nullable();
const NullableInt = z.int().nullable();

// Mirrors mcp-server.ts's own `objectItems()`: an array of loosely-typed
// objects where every declared field is optional and extra keys are
// allowed -- none of these result-item shapes declare a `required` set.
function optionalShape<T extends Record<string, z.ZodTypeAny>>(shape: T) {
  const out: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(shape)) {
    out[key] = value.optional();
  }
  return out as { [K in keyof T]: z.ZodOptional<T[K]> };
}
function objectItems<T extends Record<string, z.ZodTypeAny>>(shape: T) {
  return z.array(z.object(optionalShape(shape)).passthrough());
}

const EconomicBoardSchema = z.enum(
  ECONOMIC_LEADERBOARD_BOARDS as [string, ...string[]],
);

const SemanticKindSchema = z.enum(SEMANTIC_TYPES as [string, ...string[]]);
// Input-schema fragment for the optional `type` scope: one record kind or a
// list -- mirrors mcp-server.ts's own semanticTypeSchema() fragment.
const SemanticTypeFilterSchema = z
  .union([SemanticKindSchema, z.array(SemanticKindSchema)])
  .describe(
    `Restrict results to one or more record kinds (${SEMANTIC_TYPES.join(", ")}). ` +
      "Accepts a single kind or a list; omit for all kinds.",
  );

// find_subnet_opportunities
export const FindSubnetOpportunitiesInput = z
  .object({
    board: EconomicBoardSchema.describe(
      "Optional single board. Omit to return all economic boards.",
    ).optional(),
    limit: z
      .int()
      .min(1)
      .max(100)
      .describe("Max subnets per board (1-100, default 10).")
      .optional(),
  })
  .strict();

export const FindSubnetOpportunitiesOutput = z
  .object({
    board: NullableString.optional(),
    observed_at: NullableString.optional(),
    with_economics_count: z.int(),
    boards: z.record(
      z.string(),
      objectItems({
        netuid: z.int(),
        slug: NullableString,
        name: NullableString,
      }),
    ),
  })
  .passthrough();

// semantic_search
export const SemanticSearchInput = z
  .object({
    query: z
      .string()
      .describe("Natural-language intent, e.g. 'summarize long documents'."),
    limit: z
      .int()
      .min(1)
      .max(20)
      .describe("Max results (1-20, default 10).")
      .optional(),
    type: SemanticTypeFilterSchema.optional(),
  })
  .strict();

export const SemanticSearchOutput = z
  .object({
    query: z.string(),
    count: z.int(),
    model: NullableString.optional(),
    results: objectItems({
      score: AnySchema,
      type: NullableString,
      netuid: NullableInt,
      slug: NullableString,
      title: NullableString,
      subtitle: NullableString,
      url: NullableString,
    }),
  })
  .passthrough();

// ask
export const AskInput = z
  .object({
    question: z
      .string()
      .describe(
        "A question about Bittensor subnets or the registry as a whole.",
      ),
    type: SemanticTypeFilterSchema.optional(),
  })
  .strict();

export const AskOutput = z
  .object({
    question: z.string(),
    answer: z.string(),
    model: NullableString.optional(),
    context_count: NullableInt.optional(),
    citations: objectItems({
      ref: AnySchema,
      score: z.number(),
      title: NullableString,
      netuid: NullableInt,
      slug: NullableString,
      url: NullableString,
    }).optional(),
  })
  .passthrough();

// find_subnet_for_task
export const FindSubnetForTaskInput = z
  .object({
    task: z
      .string()
      .describe("What you want to accomplish, in plain language."),
    limit: z
      .int()
      .min(1)
      .max(20)
      .describe("Max subnets to return (1-20, default 5).")
      .optional(),
  })
  .strict();

export const FindSubnetForTaskOutput = z
  .object({
    task: z.string(),
    count: z.int(),
    discovery: AnySchema.optional(),
    note: NullableString.optional(),
    results: z.array(z.object({}).passthrough()),
  })
  .passthrough();

// how_do_i_call
export const HowDoICallInput = z
  .object({
    netuid: z.int().min(0).describe("The subnet's netuid.").optional(),
    subnet: z
      .string()
      .describe(
        "Subnet slug or chain name (e.g. 'apex'); alternative to netuid.",
      )
      .optional(),
  })
  .strict();

export const HowDoICallOutput = z
  .object({
    netuid: z.int(),
    name: NullableString.optional(),
    slug: NullableString.optional(),
    integration_readiness: AnySchema.optional(),
    callable: z.boolean(),
    callable_count: z.int().optional(),
    guidance: AnySchema.optional(),
    services: z.array(z.object({}).passthrough()),
    next_steps: z.array(z.unknown()).optional(),
    operational_observed_at: NullableString.optional(),
    health_source: NullableString.optional(),
  })
  .passthrough();

// verify_integration
export const VerifyIntegrationInput = z
  .object({
    surface_id: z
      .string()
      .describe(
        'Surface id, stable surface_key, or deprecated surface_id alias to verify, e.g. "7:subnet-api:x", "nodies-finney-rpc", or "srf-4d92fe6304cbb843".',
      )
      .optional(),
    netuid: z
      .int()
      .min(0)
      .describe(
        "Alternatively, a subnet netuid — verifies that subnet's primary catalogued surface.",
      )
      .optional(),
  })
  .strict();

export const VerifyIntegrationOutput = z
  .object({
    surface_id: z.string(),
    surface_key: NullableString.optional(),
    netuid: NullableInt.optional(),
    kind: z.string().optional(),
    url: z.string().optional(),
    provider: NullableString.optional(),
    status: z.string(),
    classification: NullableString.optional(),
    callable: z.boolean(),
    latency_ms: NullableInt.optional(),
    status_code: NullableInt.optional(),
    error: NullableString.optional(),
    probed_at: NullableString.optional(),
    from_cache: z.boolean().optional(),
  })
  .passthrough();

// call_subnet_surface
export const CallSubnetSurfaceInput = z
  .object({
    surface_id: z
      .string()
      .describe(
        'Surface id, stable surface_key, or deprecated surface_id alias to call, e.g. "7:subnet-api:x", "nodies-finney-rpc", or "srf-4d92fe6304cbb843".',
      ),
    query: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .describe(
        "Optional query parameters merged onto the effective URL (the surface's curated url, or `path` below when given), for surfaces whose notes/schema indicate they accept them.",
      )
      .optional(),
    path: z
      .string()
      .describe(
        "Optional concrete path to call on this surface's host instead of its single curated url, e.g. \"/users/123\". Must be declared in the surface's captured schema (see get_api_schema) -- an undeclared path is rejected. Requires `method` to also be set.",
      )
      .optional(),
    method: z
      .enum(["GET", "HEAD", "POST", "PUT"])
      .describe(
        "HTTP method for `path` above. Requires `path` to also be set; ignored otherwise.",
      )
      .optional(),
    body: z
      .union([z.object({}).passthrough(), z.string()])
      .describe(
        "Request body for a POST/PUT `path` call, when the matched operation declares one. A JSON object is serialized for a JSON content type; use a string body for any other declared content type. Ignored for GET/HEAD.",
      )
      .optional(),
    content_type: z
      .string()
      .describe(
        'Media type for `body`, e.g. "application/json". Must be one the matched operation declares. Optional when the operation declares application/json or exactly one media type.',
      )
      .optional(),
    credential: z
      .union([z.string(), z.object({}).passthrough()])
      .describe(
        'Credential for an auth_required surface -- see this surface\'s auth details (list_subnet_apis/get_api_schema) for which shape it needs. For auth.scheme bearer/api-key/basic: a single string, already formatted per auth.value_format (e.g. "Bearer <token>" or "Basic <base64(username:password)>"). For auth.scheme signature (e.g. a Bittensor hotkey-signed request): an object mapping every name in auth.names to a value YOU have already computed -- this tool never signs anything itself, you must compute the signature yourself (with your own wallet/key, exactly as if calling the subnet directly) before calling this tool; the object\'s keys must exactly match auth.names, no more, no fewer. Any other scheme (custom, oauth2, or incompletely documented) is rejected. Never obtains a credential on your behalf, never stores or reuses one past this single call.',
      )
      .optional(),
  })
  .strict();

export const CallSubnetSurfaceOutput = z
  .object({
    surface_id: z.string(),
    url: z.string(),
    status_code: z.int(),
    content_type: NullableString.optional(),
    latency_ms: NullableInt.optional(),
    body: AnySchema.optional(),
    truncated: z.boolean(),
    parse_error: NullableString.optional(),
  })
  .passthrough();
