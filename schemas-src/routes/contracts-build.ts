// GET /api/v1, /api/v1/contracts, /api/v1/openapi.json, /api/v1/changelog,
// /api/v1/build (types-epic B batch 10, #8064). No-input, baked-artifact/
// meta routes. Modeled from the hand-edited ApiIndexArtifact/ContractsArtifact/
// OpenApiArtifact/ChangelogArtifact/BuildSummaryArtifact components they
// replace, plus the sub-shapes only they use (ArtifactContractEntry, ApiRoute,
// ApiQueryParameter, ResponseEnvelopeContract, ArtifactDiffEntry,
// ArtifactSizeBudget) -- each referenced only from within this batch's own
// routes (verified via repo-wide $ref grep), so kept as plain local consts
// rather than registered components (same orphan treatment as batch 7/8's
// single-use sub-shapes).
import { z } from "zod";
import {
  ArtifactBaseSchema,
  CacheProfileSchema,
  successEnvelopeSchema,
} from "../envelope.ts";

const ArtifactContractEntrySchema = z
  .object({
    content_type: z.string().optional(),
    retirement: z
      .object({
        code: z.string(),
        http_status: z.int(),
        message: z.string(),
      })
      .strict()
      .nullable()
      .optional(),
    status: z.enum(["live", "retired"]),
    contract_version: z.string(),
    description: z.string().optional(),
    id: z.string(),
    path: z.string().regex(/^\/metagraph\//),
    schema_ref: z
      .string()
      .regex(/^#\/components\/schemas\/[A-Za-z0-9]+$/)
      .nullable(),
    storage_tier: z.enum(["dual", "git", "r2"]),
  })
  .strict();

const ApiQueryParameterSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    schema: z.object({}).passthrough(),
  })
  .strict();

const ApiRouteSchema = z
  .object({
    artifact_path: z.string().regex(/^\/metagraph\//),
    cache: CacheProfileSchema,
    description: z.string(),
    id: z.string(),
    method: z.enum(["GET"]),
    path: z.string().regex(/^\/api\/v1/),
    public: z.literal(true),
    query_collection: z.string().nullable().optional(),
    query_filter_names: z.array(z.string()).optional(),
    query_parameters: z.array(ApiQueryParameterSchema),
  })
  .strict();

const ResponseEnvelopeContractSchema = z
  .object({
    error_schema_ref: z.literal("#/components/schemas/ErrorEnvelope"),
    fields: z.array(z.enum(["ok", "data", "meta", "error"])),
    notes: z.string(),
    schema_version: z.literal(1),
    success_schema_ref: z.literal("#/components/schemas/SuccessEnvelope"),
  })
  .strict();

export const ApiIndexArtifactSchema = ArtifactBaseSchema.extend({
  artifact_contracts: z.array(ArtifactContractEntrySchema),
  base_path: z.literal("/api/v1"),
  openapi_url: z.literal("/api/v1/openapi.json"),
  primary_domain: z.literal("api.metagraph.sh"),
  response_envelope: ResponseEnvelopeContractSchema,
  routes: z.array(ApiRouteSchema),
  type_definitions_url: z.literal("/metagraph/types.d.ts"),
}).passthrough();
export type ApiIndexArtifact = z.infer<typeof ApiIndexArtifactSchema>;
export const ApiIndexResponseSchema = successEnvelopeSchema(
  ApiIndexArtifactSchema,
);

export const ContractsArtifactSchema = ArtifactBaseSchema.extend({
  artifacts: z.array(ArtifactContractEntrySchema),
  base_path: z.literal("/metagraph"),
  name: z.string(),
  openapi_url: z.literal("/metagraph/openapi.json"),
  primary_domain: z.literal("api.metagraph.sh"),
  status_domain: z.null(),
  type_definitions_url: z.literal("/metagraph/types.d.ts"),
}).passthrough();
export type ContractsArtifact = z.infer<typeof ContractsArtifactSchema>;
export const ContractsResponseSchema = successEnvelopeSchema(
  ContractsArtifactSchema,
);

// Standalone -- unlike every other artifact here, this one is NOT wrapped in
// ArtifactBase (the hand-edited OpenApiArtifact component it replaces has no
// allOf/ArtifactBase ref either: it's the OpenAPI document itself, not a
// /metagraph artifact envelope).
export const OpenApiArtifactSchema = z
  .object({
    openapi: z.literal("3.1.0"),
    info: z.object({}).passthrough(),
    servers: z.array(z.object({}).passthrough()).optional(),
    paths: z.object({}).passthrough(),
    components: z.object({}).passthrough(),
    "x-metagraphed": z.object({}).passthrough().optional(),
  })
  .passthrough();
export type OpenApiArtifact = z.infer<typeof OpenApiArtifactSchema>;
export const OpenApiResponseSchema = successEnvelopeSchema(
  OpenApiArtifactSchema,
);

const ArtifactDiffEntrySchema = z.union([
  z.string(),
  z
    .object({
      path: z.string(),
      hash: z.string().optional(),
      previous_hash: z.string().nullable().optional(),
    })
    .strict(),
]);

const CoverageDeltaSchema = z
  .object({
    after: z.int().min(0),
    before: z.int().min(0),
    delta: z.int(),
  })
  .strict();

export const ChangelogArtifactSchema = ArtifactBaseSchema.extend({
  artifacts: z
    .object({
      added: z.array(ArtifactDiffEntrySchema),
      modified: z.array(ArtifactDiffEntrySchema),
      removed: z.array(ArtifactDiffEntrySchema),
    })
    .strict(),
  source: z.literal("generated-artifact-diff"),
  subnets: z
    .object({
      added: z.array(z.int()),
      removed: z.array(z.int()),
      renamed: z.array(z.object({}).passthrough()),
    })
    .strict(),
  summary: z
    .object({
      artifact_added_count: z.int().min(0),
      artifact_modified_count: z.int().min(0),
      artifact_removed_count: z.int().min(0),
      coverage_delta: z
        .record(z.string(), z.union([CoverageDeltaSchema, z.null()]))
        .nullable(),
      netuid_added_count: z.int().min(0),
      netuid_removed_count: z.int().min(0),
      netuid_renamed_count: z.int().min(0),
    })
    .strict(),
}).passthrough();
export type ChangelogArtifact = z.infer<typeof ChangelogArtifactSchema>;
export const ChangelogResponseSchema = successEnvelopeSchema(
  ChangelogArtifactSchema,
);

const ArtifactSizeBudgetSchema = z
  .object({
    path: z.string(),
    size_bytes: z.int().min(0),
    warn_bytes: z.int().min(0),
    fail_bytes: z.int().min(0),
    status: z.enum(["ok", "warn", "fail"]),
  })
  .strict();

export const BuildSummaryArtifactSchema = ArtifactBaseSchema.extend({
  published_at: z.iso.datetime().nullable().optional(),
  artifact_count: z.int().min(0),
  artifact_size_bytes: z.int().min(0),
  subnet_count: z.int().min(0),
  surface_count: z.int().min(0),
  candidate_count: z.int().min(0).optional(),
  provider_count: z.int().min(0).optional(),
  artifact_budgets: z.array(ArtifactSizeBudgetSchema).optional(),
}).passthrough();
export type BuildSummaryArtifact = z.infer<typeof BuildSummaryArtifactSchema>;
export const BuildSummaryResponseSchema = successEnvelopeSchema(
  BuildSummaryArtifactSchema,
);
