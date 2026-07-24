// Equivalence-diff audit for the Zod-generated MCP tool schemas (types-epic
// E batch 12, #8076): compares each Zod-owned tool's inputSchema/
// outputSchema against the hand-written JSON Schema 2020-12 literal it
// replaced in src/mcp-server.ts (frozen below, since the working tree
// already has those literals deleted), after normalizing the specific
// cosmetic differences z.toJSONSchema() introduces. Anything left after
// normalization is a real (bucket a/b) difference and must be resolved
// before merge, not silenced here. Mirrors the equivalence-diff pattern
// scripts/diff-openapi-zod-components.ts uses for the REST-route Zod layer
// (types-epic B), adapted for tool schemas: no $ref/allOf/ArtifactBase
// nesting here, but a few tool-specific shapes (multi-type unions, loose
// array items) need their own normalization branches instead.
import { z } from "zod";
import { ECONOMIC_LEADERBOARD_BOARDS } from "../src/health-serving.ts";
import {
  AskInput,
  AskOutput,
  CallSubnetSurfaceInput,
  CallSubnetSurfaceOutput,
  FindSubnetForTaskInput,
  FindSubnetForTaskOutput,
  FindSubnetOpportunitiesInput,
  FindSubnetOpportunitiesOutput,
  HowDoICallInput,
  HowDoICallOutput,
  SemanticSearchInput,
  SemanticSearchOutput,
  VerifyIntegrationInput,
  VerifyIntegrationOutput,
} from "../schemas-src/mcp-tools.ts";

type Row = Record<string, unknown>;

const MAX_SAFE_INT = Number.MAX_SAFE_INTEGER;

// Recursively normalizes the cosmetic-only differences between a
// hand-written JSON Schema literal and Zod's z.toJSONSchema() output for the
// equivalent Zod schema, so a structural deep-equal after normalization
// isolates genuine (bucket a/b) differences.
function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (!node || typeof node !== "object") return node;
  const obj = node as Row;

  // Multi-type `type` arrays (nullable-with-no-siblings, or a bare
  // string/object/number/boolean union) -- hand-written literals declare
  // these as `type: [A, B, ...]`; Zod unions/`.nullable()` emit `anyOf`
  // branches instead. Rewrite the `type`-array side into the same anyOf
  // shape (none of this file's multi-type fields carry sibling keys like
  // minimum/properties that would need distributing per-branch).
  if (Array.isArray(obj.type)) {
    const { type, ...siblings } = obj;
    return normalize({
      anyOf: (type as string[]).map((t) => ({ type: t, ...siblings })),
    });
  }

  const out: Row = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "$schema" || key === "$id") continue; // Zod-only bookkeeping

    // Descriptions are a documented cosmetic difference (the issue's own
    // wire-compatibility clause: "Cosmetic differences (key order, $schema
    // presence, description strings) are acceptable") -- strip from both
    // sides so this structural pass isn't drowned out by them.
    if (key === "description") continue;

    // z.record(z.string(), ...) stamps `propertyNames: {type: "string"}` --
    // always true for a JSON object (every key is already a string), never
    // declared by the hand-written literals.
    if (
      key === "propertyNames" &&
      value &&
      typeof value === "object" &&
      (value as Row).type === "string" &&
      Object.keys(value as Row).length === 1
    ) {
      continue;
    }

    // `required` is a JSON Schema SET -- order never affects validation;
    // sort both sides so declaration-order vs. Zod's emitted order never
    // shows up as a diff.
    if (key === "required" && Array.isArray(value)) {
      out[key] = [...(value as string[])].sort();
      continue;
    }

    // z.object({}).passthrough() (the "any object" carve-out for
    // body/credential's object branch) emits an empty `properties: {}`
    // alongside `additionalProperties: {}`; the hand-written literals just
    // omit `properties` entirely for the same "no fixed keys" shape.
    if (
      key === "properties" &&
      value &&
      typeof value === "object" &&
      Object.keys(value).length === 0
    ) {
      continue;
    }

    if (key === "examples") continue;

    // z.int() with no explicit .max()/.min() stamps Number.MAX_SAFE_INTEGER
    // sentinel bounds; the hand-written integers never declare these.
    if (
      (key === "maximum" && value === MAX_SAFE_INT) ||
      (key === "minimum" && value === -MAX_SAFE_INT)
    ) {
      continue;
    }

    // additionalProperties: {} (Zod's .passthrough()/.record() value-any
    // side) vs additionalProperties: true (hand-written) -- both mean "any
    // extra properties allowed".
    if (
      key === "additionalProperties" &&
      value &&
      typeof value === "object" &&
      Object.keys(value).length === 0
    ) {
      out[key] = true;
      continue;
    }

    // `items: {}` (Zod's z.array(z.unknown()/z.any())) vs an omitted
    // `items` key (hand-written) -- both mean "array of anything"; handled
    // below via the post-loop default-fill instead of here, so both sides
    // converge on the same explicit shape regardless of which one had it.
    if (
      key === "items" &&
      value &&
      typeof value === "object" &&
      Object.keys(value).length === 0
    ) {
      continue;
    }

    if (key === "oneOf") {
      out.anyOf = normalize(value);
      continue;
    }

    out[key] = normalize(value);
  }

  // JSON Schema defaults `additionalProperties` to `true` when omitted --
  // the hand-written literals rely on that default in a few places (e.g.
  // `items: {type: "object"}` with no additionalProperties key at all);
  // Zod always emits it explicitly. Inject the same default so an omitted
  // key on either side compares equal to an explicit `true`.
  if (out.type === "object" && !("additionalProperties" in out)) {
    out.additionalProperties = true;
  }

  if (Array.isArray(out.anyOf) && out.anyOf.length === 1) {
    Object.assign(out, out.anyOf[0]);
    delete out.anyOf;
  }

  return sortKeys(out);
}

function sortKeys(obj: Row): Row {
  const sorted: Row = {};
  for (const key of Object.keys(obj).sort()) sorted[key] = obj[key];
  return sorted;
}

// Stable stringify for order-independent anyOf/array-branch comparison.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).sort().join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Row)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Row)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// Frozen copies of the hand-written literals this batch replaced in
// src/mcp-server.ts (git blame that file's history at #8076 for the
// originals) -- kept here only for this one-off equivalence proof.
const OLD_INPUT_SCHEMAS: Record<string, Row> = {
  find_subnet_opportunities: {
    type: "object",
    properties: {
      board: {
        type: "string",
        // Generated (src/health-serving.ts) -- read the live values so this
        // audit never drifts from the actual runtime enum instead of
        // hand-duplicating it.
        enum: [...ECONOMIC_LEADERBOARD_BOARDS],
        description:
          "Optional single board. Omit to return all economic boards.",
      },
      limit: {
        type: "integer",
        description: "Max subnets per board (1-100, default 10).",
        minimum: 1,
        maximum: 100,
      },
    },
    additionalProperties: false,
  },
  semantic_search: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Natural-language intent, e.g. 'summarize long documents'.",
      },
      limit: {
        type: "integer",
        description: "Max results (1-20, default 10).",
        minimum: 1,
        maximum: 20,
      },
      type: {
        description:
          "Restrict results to one or more record kinds (subnet, surface, provider). " +
          "Accepts a single kind or a list; omit for all kinds.",
        oneOf: [
          { type: "string", enum: ["subnet", "surface", "provider"] },
          {
            type: "array",
            items: { type: "string", enum: ["subnet", "surface", "provider"] },
          },
        ],
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  ask: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "A question about Bittensor subnets or the registry as a whole.",
      },
      type: {
        description:
          "Restrict results to one or more record kinds (subnet, surface, provider). " +
          "Accepts a single kind or a list; omit for all kinds.",
        oneOf: [
          { type: "string", enum: ["subnet", "surface", "provider"] },
          {
            type: "array",
            items: { type: "string", enum: ["subnet", "surface", "provider"] },
          },
        ],
      },
    },
    required: ["question"],
    additionalProperties: false,
  },
  find_subnet_for_task: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "What you want to accomplish, in plain language.",
      },
      limit: {
        type: "integer",
        description: "Max subnets to return (1-20, default 5).",
        minimum: 1,
        maximum: 20,
      },
    },
    required: ["task"],
    additionalProperties: false,
  },
  how_do_i_call: {
    type: "object",
    properties: {
      netuid: {
        type: "integer",
        minimum: 0,
        description: "The subnet's netuid.",
      },
      subnet: {
        type: "string",
        description:
          "Subnet slug or chain name (e.g. 'apex'); alternative to netuid.",
      },
    },
    additionalProperties: false,
  },
  verify_integration: {
    type: "object",
    properties: {
      surface_id: {
        type: "string",
        description:
          'Surface id, stable surface_key, or deprecated surface_id alias to verify, e.g. "7:subnet-api:x", "nodies-finney-rpc", or "srf-4d92fe6304cbb843".',
      },
      netuid: {
        type: "integer",
        minimum: 0,
        description:
          "Alternatively, a subnet netuid — verifies that subnet's primary catalogued surface.",
      },
    },
    additionalProperties: false,
  },
  call_subnet_surface: {
    type: "object",
    properties: {
      surface_id: {
        type: "string",
        description:
          'Surface id, stable surface_key, or deprecated surface_id alias to call, e.g. "7:subnet-api:x", "nodies-finney-rpc", or "srf-4d92fe6304cbb843".',
      },
      query: {
        type: "object",
        description:
          "Optional query parameters merged onto the effective URL (the surface's curated url, or `path` below when given), for surfaces whose notes/schema indicate they accept them.",
        additionalProperties: { type: ["string", "number", "boolean"] },
      },
      path: {
        type: "string",
        description:
          "Optional concrete path to call on this surface's host instead of its single curated url, e.g. \"/users/123\". Must be declared in the surface's captured schema (see get_api_schema) -- an undeclared path is rejected. Requires `method` to also be set.",
      },
      method: {
        type: "string",
        enum: ["GET", "HEAD", "POST", "PUT"],
        description:
          "HTTP method for `path` above. Requires `path` to also be set; ignored otherwise.",
      },
      body: {
        type: ["object", "string"],
        description:
          "Request body for a POST/PUT `path` call, when the matched operation declares one. A JSON object is serialized for a JSON content type; use a string body for any other declared content type. Ignored for GET/HEAD.",
      },
      content_type: {
        type: "string",
        description:
          'Media type for `body`, e.g. "application/json". Must be one the matched operation declares. Optional when the operation declares application/json or exactly one media type.',
      },
      credential: {
        type: ["string", "object"],
        description:
          'Credential for an auth_required surface -- see this surface\'s auth details (list_subnet_apis/get_api_schema) for which shape it needs. For auth.scheme bearer/api-key/basic: a single string, already formatted per auth.value_format (e.g. "Bearer <token>" or "Basic <base64(username:password)>"). For auth.scheme signature (e.g. a Bittensor hotkey-signed request): an object mapping every name in auth.names to a value YOU have already computed -- this tool never signs anything itself, you must compute the signature yourself (with your own wallet/key, exactly as if calling the subnet directly) before calling this tool; the object\'s keys must exactly match auth.names, no more, no fewer. Any other scheme (custom, oauth2, or incompletely documented) is rejected. Never obtains a credential on your behalf, never stores or reuses one past this single call.',
      },
    },
    required: ["surface_id"],
    additionalProperties: false,
  },
};

const ANY = {};
const NULLABLE_STRING = { type: ["string", "null"] };
const NULLABLE_INT = { type: ["integer", "null"] };
const objectItems = (properties: Row = {}) => ({
  type: "array",
  items: { type: "object", additionalProperties: true, properties },
});

const OLD_OUTPUT_SCHEMAS: Record<string, Row> = {
  find_subnet_for_task: {
    type: "object",
    additionalProperties: true,
    required: ["task", "count", "results"],
    properties: {
      task: { type: "string" },
      count: { type: "integer" },
      discovery: ANY,
      note: NULLABLE_STRING,
      results: { type: "array", items: { type: "object" } },
    },
  },
  how_do_i_call: {
    type: "object",
    additionalProperties: true,
    required: ["netuid", "callable", "services"],
    properties: {
      netuid: { type: "integer" },
      name: NULLABLE_STRING,
      slug: NULLABLE_STRING,
      integration_readiness: ANY,
      callable: { type: "boolean" },
      callable_count: { type: "integer" },
      guidance: ANY,
      services: { type: "array", items: { type: "object" } },
      next_steps: { type: "array" },
      operational_observed_at: NULLABLE_STRING,
      health_source: NULLABLE_STRING,
    },
  },
  find_subnet_opportunities: {
    type: "object",
    additionalProperties: true,
    required: ["boards", "with_economics_count"],
    properties: {
      board: NULLABLE_STRING,
      observed_at: NULLABLE_STRING,
      with_economics_count: { type: "integer" },
      boards: {
        type: "object",
        additionalProperties: objectItems({
          netuid: { type: "integer" },
          slug: NULLABLE_STRING,
          name: NULLABLE_STRING,
        }),
      },
    },
  },
  semantic_search: {
    type: "object",
    additionalProperties: true,
    required: ["query", "count", "results"],
    properties: {
      query: { type: "string" },
      count: { type: "integer" },
      model: NULLABLE_STRING,
      results: objectItems({
        score: ANY,
        type: NULLABLE_STRING,
        netuid: NULLABLE_INT,
        slug: NULLABLE_STRING,
        title: NULLABLE_STRING,
        subtitle: NULLABLE_STRING,
        url: NULLABLE_STRING,
      }),
    },
  },
  ask: {
    type: "object",
    additionalProperties: true,
    required: ["question", "answer"],
    properties: {
      question: { type: "string" },
      answer: { type: "string" },
      model: NULLABLE_STRING,
      context_count: NULLABLE_INT,
      citations: objectItems({
        ref: ANY,
        score: { type: "number" },
        title: NULLABLE_STRING,
        netuid: NULLABLE_INT,
        slug: NULLABLE_STRING,
        url: NULLABLE_STRING,
      }),
    },
  },
  verify_integration: {
    type: "object",
    additionalProperties: true,
    required: ["surface_id", "status", "callable"],
    properties: {
      surface_id: { type: "string" },
      surface_key: NULLABLE_STRING,
      netuid: NULLABLE_INT,
      kind: { type: "string" },
      url: { type: "string" },
      provider: NULLABLE_STRING,
      status: { type: "string" },
      classification: NULLABLE_STRING,
      callable: { type: "boolean" },
      latency_ms: NULLABLE_INT,
      status_code: NULLABLE_INT,
      error: NULLABLE_STRING,
      probed_at: NULLABLE_STRING,
      from_cache: { type: "boolean" },
    },
  },
  call_subnet_surface: {
    type: "object",
    additionalProperties: true,
    required: ["surface_id", "url", "status_code", "truncated"],
    properties: {
      surface_id: { type: "string" },
      url: { type: "string" },
      status_code: { type: "integer" },
      content_type: NULLABLE_STRING,
      latency_ms: NULLABLE_INT,
      body: {},
      truncated: { type: "boolean" },
      parse_error: NULLABLE_STRING,
    },
  },
};

const TOOLS: Array<{
  name: string;
  input: z.ZodType;
  output: z.ZodType;
}> = [
  {
    name: "find_subnet_opportunities",
    input: FindSubnetOpportunitiesInput,
    output: FindSubnetOpportunitiesOutput,
  },
  {
    name: "semantic_search",
    input: SemanticSearchInput,
    output: SemanticSearchOutput,
  },
  { name: "ask", input: AskInput, output: AskOutput },
  {
    name: "find_subnet_for_task",
    input: FindSubnetForTaskInput,
    output: FindSubnetForTaskOutput,
  },
  { name: "how_do_i_call", input: HowDoICallInput, output: HowDoICallOutput },
  {
    name: "verify_integration",
    input: VerifyIntegrationInput,
    output: VerifyIntegrationOutput,
  },
  {
    name: "call_subnet_surface",
    input: CallSubnetSurfaceInput,
    output: CallSubnetSurfaceOutput,
  },
];

let diffCount = 0;
let total = 0;
for (const { name, input, output } of TOOLS) {
  for (const [kind, schema, oldSchemas] of [
    ["inputSchema", input, OLD_INPUT_SCHEMAS],
    ["outputSchema", output, OLD_OUTPUT_SCHEMAS],
  ] as const) {
    total++;
    const old = oldSchemas[name];
    const fresh = z.toJSONSchema(schema, { target: "draft-2020-12" });
    const normalizedOld = stableStringify(normalize(old));
    const normalizedNew = stableStringify(normalize(fresh));
    if (normalizedOld === normalizedNew) {
      console.log(
        `${name}.${kind}: PASS (equivalent after normalizing cosmetic diffs)`,
      );
    } else {
      diffCount++;
      console.log(`${name}.${kind}: DIFF`);
      console.log("  old (normalized):", normalizedOld);
      console.log("  new (normalized):", normalizedNew);
    }
  }
}

console.log(`\n${total - diffCount}/${total} schemas PASS; ${diffCount} DIFF.`);
if (diffCount > 0) process.exit(1);
