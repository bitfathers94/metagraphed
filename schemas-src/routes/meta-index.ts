// GET /api/v1/search, /api/v1/search-index, /api/v1/freshness,
// /api/v1/source-health, /api/v1/source-snapshots, /api/v1/schemas
// (types-epic B batch 10, #8064). No path/query params for any of these six.
// Modeled from the hand-edited SearchArtifact/SearchIndexArtifact/
// FreshnessArtifact/SourceHealthArtifact/SourceSnapshotsArtifact/
// SchemaIndexArtifact components they replace, plus the SearchDocument/
// SearchIndexDocument/FreshnessSource/SourceHealthProvider/SourceSnapshot/
// SchemaIndexEntry sub-shapes -- each referenced only from within this
// batch's own routes (verified via repo-wide $ref grep), kept as plain
// local consts rather than registered components, same orphan treatment as
// batch 7/8's single-use sub-shapes.
import { z } from "zod";
import {
  ArtifactBaseSchema,
  CountMapSchema,
  successEnvelopeSchema,
} from "../envelope.ts";
import { HealthStatusSchema, ProviderKindSchema } from "../shared.ts";
import { AuthoritySchema } from "./subnet-detail.ts";

const SearchDocTypeSchema = z.enum(["subnet", "surface", "provider"]);

const SearchDocumentSchema = z
  .object({
    id: z.string(),
    type: SearchDocTypeSchema,
    netuid: z.int().min(0).optional(),
    slug: z.string().optional(),
    title: z.string(),
    subtitle: z.string().optional(),
    url: z.string().optional(),
    artifact_path: z.string(),
    tokens: z.array(z.string()),
    categories: z.array(z.string()).optional(),
    service_kinds: z.array(z.string()).optional(),
  })
  .strict();

export const SearchArtifactSchema = ArtifactBaseSchema.extend({
  document_count: z.int().min(0).optional(),
  documents: z.array(SearchDocumentSchema),
}).passthrough();
export type SearchArtifact = z.infer<typeof SearchArtifactSchema>;
export const SearchResponseSchema = successEnvelopeSchema(SearchArtifactSchema);

const SearchIndexDocumentSchema = z
  .object({
    id: z.string(),
    type: SearchDocTypeSchema,
    netuid: z.int().min(0).optional(),
    slug: z.string().optional(),
    title: z.string(),
    subtitle: z.string().optional(),
    url: z.string().optional(),
    artifact_path: z.string(),
    categories: z.array(z.string()).optional(),
    service_kinds: z.array(z.string()).optional(),
  })
  .strict();

export const SearchIndexArtifactSchema = ArtifactBaseSchema.extend({
  document_count: z.int().min(0).optional(),
  documents: z.array(SearchIndexDocumentSchema),
}).passthrough();
export type SearchIndexArtifact = z.infer<typeof SearchIndexArtifactSchema>;
export const SearchIndexResponseSchema = successEnvelopeSchema(
  SearchIndexArtifactSchema,
);

const FreshnessSourceSchema = z
  .object({
    as_of: z.string().nullable(),
    id: z.string(),
    lane: z.enum([
      "adapter-snapshot",
      "candidate-discovery",
      "candidate-verification",
      "health-probe",
      "native-data",
      "schema-snapshot",
    ]),
    notes: z.string().optional(),
    path: z.string(),
    required_for_publish: z.boolean(),
    stale_after_hours: z.int().min(0),
    stale_behavior: z.enum(["block", "warn"]),
    status: z.enum(["captured", "current", "degraded", "missing", "stale"]),
    timestamp: z.string().nullable(),
    timestamp_field: z.string().nullable(),
  })
  .strict();

export const FreshnessArtifactSchema = ArtifactBaseSchema.extend({
  sources: z.array(FreshnessSourceSchema),
  summary: z
    .object({
      adapter_count: z.int().min(0),
      adapter_snapshot_as_of: z.string().nullable(),
      blocking_source_count: z.int().min(0),
      candidate_discovery_as_of: z.string().nullable(),
      health_surface_count: z.int().min(0),
      health_probe_as_of: z.string().nullable(),
      missing_blocking_source_count: z.int().min(0),
      native_snapshot_captured_at: z.string(),
      native_data_as_of: z.string(),
      openapi_surface_count: z.int().min(0),
      publish_ready_without_age_check: z.boolean(),
      schema_snapshot_as_of: z.string().nullable(),
      stale_window_warnings: z.array(z.string()),
      verification_as_of: z.string().nullable(),
      verification_generated_at: z.string().nullable(),
      warning_source_count: z.int().min(0),
    })
    .strict(),
}).passthrough();
export type FreshnessArtifact = z.infer<typeof FreshnessArtifactSchema>;
export const FreshnessResponseSchema = successEnvelopeSchema(
  FreshnessArtifactSchema,
);

const SourceHealthProviderSchema = z
  .object({
    authority: AuthoritySchema,
    candidate_count: z.int().min(0),
    classifications: CountMapSchema,
    endpoint_count: z.int().min(0),
    id: z.string(),
    kind: ProviderKindSchema,
    name: z.string(),
    rpc_endpoint_count: z.int().min(0),
    status: HealthStatusSchema,
    verification_result_count: z.int().min(0),
  })
  .strict();

export const SourceHealthArtifactSchema = ArtifactBaseSchema.extend({
  providers: z.array(SourceHealthProviderSchema),
  source: z.literal("generated-provider-and-verification-summary"),
  summary: z
    .object({
      candidate_count: z.int().min(0),
      endpoint_count: z.int().min(0),
      provider_count: z.int().min(0),
      rpc_endpoint_count: z.int().min(0),
      status_counts: CountMapSchema,
      verification_result_count: z.int().min(0),
    })
    .strict(),
}).passthrough();
export type SourceHealthArtifact = z.infer<typeof SourceHealthArtifactSchema>;
export const SourceHealthResponseSchema = successEnvelopeSchema(
  SourceHealthArtifactSchema,
);

const SourceSnapshotSchema = z
  .object({
    captured_at: z.string(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    id: z.string(),
    kind: z.enum([
      "adapter-snapshot",
      "candidate-discovery",
      "native-chain",
      "probe-results",
      "registry-manifest",
      "review-ledger",
    ]),
    path: z.string(),
    record_count: z.int().min(0),
  })
  .strict();

export const SourceSnapshotsArtifactSchema = ArtifactBaseSchema.extend({
  sources: z.array(SourceSnapshotSchema),
  summary: z
    .object({
      adapter_snapshot_count: z.int().min(0),
      candidate_count: z.int().min(0),
      overlay_count: z.int().min(0),
      provider_count: z.int().min(0),
      source_count: z.int().min(0),
      verification_result_count: z.int().min(0),
    })
    .strict(),
}).passthrough();
export type SourceSnapshotsArtifact = z.infer<
  typeof SourceSnapshotsArtifactSchema
>;
export const SourceSnapshotsResponseSchema = successEnvelopeSchema(
  SourceSnapshotsArtifactSchema,
);

const SchemaIndexEntrySchema = z
  .object({
    content_type: z.string().nullable().optional(),
    drift_status: z.enum([
      "changed",
      "missing-after-previous-capture",
      "new",
      "not-captured",
      "unchanged",
    ]),
    error: z.string().nullable().optional(),
    hash: z.string().nullable().optional(),
    netuid: z.int().min(0).optional(),
    path: z.string().nullable().optional(),
    previous_hash: z.string().nullable().optional(),
    schema_url: z.url().nullable(),
    snapshot: z.object({}).passthrough().optional(),
    status: z.enum([
      "captured",
      "error",
      "not-captured",
      "not-found",
      "too-large",
      "unsafe",
    ]),
    subnet_slug: z.string().optional(),
    surface_id: z.string(),
    url: z.url().optional(),
  })
  .strict();

export const SchemaIndexArtifactSchema = ArtifactBaseSchema.extend({
  schemas: z.array(SchemaIndexEntrySchema),
  source: z.string(),
}).passthrough();
export type SchemaIndexArtifact = z.infer<typeof SchemaIndexArtifactSchema>;
export const SchemaIndexResponseSchema = successEnvelopeSchema(
  SchemaIndexArtifactSchema,
);
