// GET /api/v1/rpc/endpoints, /api/v1/rpc/pools, /api/v1/rpc/usage
// (types-epic B batch 10, #8064). No path/query params for endpoints+usage;
// pools has none either. Modeled from the hand-edited RpcEndpointsArtifact/
// RpcPoolsArtifact/RpcUsageArtifact components they replace, plus the
// RpcEndpoint/RpcPool/RpcPoolEndpoint/EndpointProviderScore sub-shapes --
// each referenced only from within this batch's own routes (verified via
// repo-wide $ref grep), kept as plain local consts rather than registered
// components, same orphan treatment as batch 7/8's single-use sub-shapes.
// RpcUsageArtifact is unlike the other two: it's a fully-live route (never a
// static file, computed from D1 telemetry) and its hand-edited component has
// no ArtifactBase wrapper -- modeled standalone to match.
import { z } from "zod";
import { ArtifactBaseSchema, successEnvelopeSchema } from "../envelope.ts";
import { BittensorNetworkSchema, HealthStatusSchema } from "../shared.ts";
import {
  AuthoritySchema,
  ClassificationSchema,
  EndpointLayerSchema,
  EndpointScoreReasonSchema,
  SurfaceKindSchema,
} from "./subnet-detail.ts";

// Distinct, narrower enum than EndpointResourceSchema's own 5-value
// health_source (subnet-detail.ts) -- the hand-edited RpcEndpoint/
// RpcPoolEndpoint/EndpointIncident components this batch's RpcEndpoint/
// RpcPoolEndpoint replace only ever declare these 3 values.
const RpcHealthSourceSchema = z.enum([
  "probe-derived",
  "missing-probe",
  "not-monitored",
]);

const RpcEndpointSchema = z
  .object({
    id: z.string(),
    auth_required: z.boolean().optional(),
    authority: AuthoritySchema.optional(),
    kind: z.enum(["subtensor-rpc", "subtensor-wss"]),
    url: z.url(),
    provider: z.string(),
    netuid: z.int().min(0).optional(),
    subnet_name: z.string().optional(),
    subnet_slug: z.string().optional(),
    status: HealthStatusSchema,
    classification: ClassificationSchema,
    network: BittensorNetworkSchema,
    chain: z.literal("bittensor"),
    archive_support: z.boolean().nullable().optional(),
    latency_ms: z.int().min(0).nullable().optional(),
    observed_at: z.string().nullable(),
    health_source: RpcHealthSourceSchema,
    health_stale: z.boolean(),
    last_ok: z.string().nullable(),
    latest_block: z.int().min(0).nullable().optional(),
    rpc_method_count: z.int().min(0).nullable().optional(),
    methods_supported: z
      .union([z.record(z.string(), z.boolean()), z.array(z.string()), z.null()])
      .optional(),
    method_tested: z.string().optional(),
    public_safe: z.boolean().optional(),
    rate_limit_notes: z.string().nullable().optional(),
    source_urls: z.array(z.url()).optional(),
    last_checked: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
  })
  .strict();

export const RpcEndpointsArtifactSchema = ArtifactBaseSchema.extend({
  summary: z
    .object({
      endpoint_count: z.int().min(0).optional(),
      archive_supported_count: z.int().min(0).optional(),
      by_kind: z.record(z.string(), z.int().min(0)).optional(),
      by_provider: z.record(z.string(), z.int().min(0)).optional(),
      by_status: z.record(z.string(), z.int().min(0)).optional(),
    })
    .passthrough(),
  endpoints: z.array(RpcEndpointSchema),
}).passthrough();
export type RpcEndpointsArtifact = z.infer<typeof RpcEndpointsArtifactSchema>;
export const RpcEndpointsResponseSchema = successEnvelopeSchema(
  RpcEndpointsArtifactSchema,
);

const RpcPoolEndpointSchema = z
  .object({
    id: z.string(),
    surface_id: z.string().optional(),
    surface_key: z.string().optional(),
    kind: SurfaceKindSchema.optional(),
    layer: EndpointLayerSchema.optional(),
    url: z.url(),
    provider: z.string(),
    auth_required: z.boolean().optional(),
    public_safe: z.boolean().optional(),
    status: HealthStatusSchema,
    score: z.int(),
    score_reasons: z.array(EndpointScoreReasonSchema).optional(),
    pool_eligible: z.boolean(),
    pool_eligibility_reasons: z.array(z.string()).optional(),
    archive_support: z.boolean().nullable().optional(),
    latency_ms: z.int().min(0).nullable().optional(),
    observed_at: z.string().nullable(),
    health_source: RpcHealthSourceSchema,
    health_stale: z.boolean(),
    last_ok: z.string().nullable(),
    latest_block: z.int().min(0).nullable().optional(),
  })
  .strict();

const RpcPoolSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    best_endpoint_id: z.string().nullable().optional(),
    endpoint_count: z.int().min(0),
    eligible_count: z.int().min(0),
    endpoints: z.array(RpcPoolEndpointSchema),
  })
  .strict();

const EndpointProviderScoreSchema = z
  .object({
    provider: z.string(),
    endpoint_count: z.int().min(0),
    monitored_count: z.int().min(0),
    ok_count: z.int().min(0),
    failed_count: z.int().min(0),
    degraded_count: z.int().min(0),
    pool_eligible_count: z.int().min(0),
    average_score: z.int(),
    operational_score: z.int(),
  })
  .strict();

export const RpcPoolsArtifactSchema = ArtifactBaseSchema.extend({
  disabled_proxy_contract: z
    .object({
      enabled: z.boolean().optional(),
      feature_flag: z.string().optional(),
      allowed_methods: z.array(z.string()).optional(),
      denied_method_patterns: z.array(z.string()).optional(),
      rate_limit_required: z.boolean().optional(),
      waf_required: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
  eligibility_policy: z
    .object({
      source: z.string().optional(),
      eligible_layers: z.array(z.string()).optional(),
      required_status: z.string().optional(),
      requires_no_auth: z.boolean().optional(),
      requires_public_safe: z.boolean().optional(),
      user_reports_can_change_health: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .passthrough()
    .optional(),
  provider_scores: z.array(EndpointProviderScoreSchema).optional(),
  pools: z.array(RpcPoolSchema),
}).passthrough();
export type RpcPoolsArtifact = z.infer<typeof RpcPoolsArtifactSchema>;
export const RpcPoolsResponseSchema = successEnvelopeSchema(
  RpcPoolsArtifactSchema,
);

export const RpcUsageArtifactSchema = z
  .object({
    schema_version: z.int(),
    window: z.string().nullable().optional(),
    bucket_granularity: z.string().nullable().optional(),
    observed_at: z.string().nullable().optional(),
    source: z.string(),
    summary: z
      .object({
        total_requests: z.int().min(0),
        ok_requests: z.int().min(0),
        error_requests: z.int().min(0),
        error_rate: z.number().nullable().optional(),
        failover_requests: z.int().min(0).optional(),
        failover_rate: z.number().nullable().optional(),
        cache_hits: z.int().min(0).optional(),
        cache_hit_rate: z.number().nullable().optional(),
        latency_ms: z
          .object({
            p50: z.int().nullable().optional(),
            p95: z.int().nullable().optional(),
            avg: z.int().nullable().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    endpoints: z.array(
      z
        .object({
          rank: z.int().min(1).optional(),
          endpoint_id: z.string().nullable(),
          provider: z.string().nullable().optional(),
          requests: z.int().min(0),
          ok_requests: z.int().min(0),
          error_rate: z.number().nullable().optional(),
          avg_latency_ms: z.int().nullable().optional(),
        })
        .passthrough(),
    ),
    networks: z.array(
      z
        .object({
          network: z.string(),
          requests: z.int().min(0),
          ok_requests: z.int().min(0),
          error_rate: z.number().nullable().optional(),
        })
        .passthrough(),
    ),
    buckets: z.array(
      z
        .object({
          ts: z.int().min(0),
          requests: z.int().min(0),
          errors: z.int().min(0),
          avg_latency_ms: z.int().nullable(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type RpcUsageArtifact = z.infer<typeof RpcUsageArtifactSchema>;
export const RpcUsageResponseSchema = successEnvelopeSchema(
  RpcUsageArtifactSchema,
);
