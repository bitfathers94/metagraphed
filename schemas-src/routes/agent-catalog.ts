// GET /api/v1/agent-catalog, /api/v1/agent-catalog/{netuid},
// /api/v1/agent-resources (types-epic B batch 10, #8064). {netuid} is a
// path param, not a query param. Modeled from the hand-edited
// AgentCatalogArtifact/AgentCatalogSubnetArtifact/AgentResourcesArtifact
// components they replace, plus AgentReadinessStatus/AgentServiceSchemaSource/
// AgentServiceFixtureStatus/SurfaceFixtureReference -- each referenced only
// from within this batch's own routes (verified via repo-wide $ref grep),
// kept as plain local consts rather than registered components, same orphan
// treatment as batch 7/8's single-use sub-shapes.
import { z } from "zod";
import { ArtifactBaseSchema, successEnvelopeSchema } from "../envelope.ts";
import { AgentReadinessBlockerSchema } from "./coverage.ts";
import { IntegrationReadinessSchema } from "./subnet-profile.ts";

const AgentReadinessStatusSchema = z
  .object({
    status: z.enum([
      "callable",
      "base-layer",
      "candidate",
      "needs-evidence",
      "blocked",
    ]),
    blocker_level: z.enum([
      "none",
      "hard-blocked",
      "needs-review",
      "missing-data",
    ]),
    blockers: z.array(AgentReadinessBlockerSchema),
    missing_fields: z.array(z.string()),
  })
  .strict();

const AgentCatalogSubnetEntrySchema = z
  .object({
    netuid: z.int().min(0),
    slug: z.string().optional(),
    name: z.string().optional(),
    categories: z.array(z.string()).optional(),
    subnet_type: z.string().nullable().optional(),
    completeness_score: z.number().nullable().optional(),
    integration_readiness: z.int().min(0).max(100).optional(),
    readiness: IntegrationReadinessSchema.optional(),
    agent_readiness: AgentReadinessStatusSchema.optional(),
    service_count: z.int().min(0),
    callable_count: z.int().min(0).optional(),
    service_kinds: z.array(z.string()).optional(),
    base_url: z.string().nullable().optional(),
    health: z.string().optional(),
    previously_known_as: z.array(z.string()).optional(),
  })
  .passthrough();

const AgentCatalogBlockedSubnetSchema = z
  .object({
    netuid: z.int().min(0),
    slug: z.string().optional(),
    name: z.string().optional(),
    categories: z.array(z.string()).optional(),
    subnet_type: z.string().nullable().optional(),
    completeness_score: z.number().nullable().optional(),
    integration_readiness: z.int().min(0).max(100).optional(),
    readiness_tier: z.string().optional(),
    service_count: z.int().min(0).optional(),
    callable_count: z.int().min(0).optional(),
    agent_readiness: AgentReadinessStatusSchema,
  })
  .passthrough();

export const AgentCatalogArtifactSchema = ArtifactBaseSchema.extend({
  total_subnet_count: z.int().min(0).optional(),
  subnet_count: z.int().min(0),
  blocked_subnet_count: z.int().min(0).optional(),
  callable_service_count: z.int().min(0).optional(),
  blocker_summary: z.object({}).passthrough().optional(),
  subnets: z.array(AgentCatalogSubnetEntrySchema),
  blocked_subnets: z.array(AgentCatalogBlockedSubnetSchema).optional(),
}).passthrough();
export type AgentCatalogArtifact = z.infer<typeof AgentCatalogArtifactSchema>;
export const AgentCatalogResponseSchema = successEnvelopeSchema(
  AgentCatalogArtifactSchema,
);

const AgentServiceSchemaSourceSchema = z
  .object({
    surface_id: z.string(),
    match: z.enum(["surface-id", "schema-url", "same-origin-openapi"]),
    url: z.string().nullable(),
    artifact: z.string().nullable(),
    status: z.string().nullable(),
    observed_at: z.string().nullable(),
    hash: z.string().nullable(),
  })
  .strict();

const AgentServiceFixtureStatusSchema = z
  .object({
    status: z.enum([
      "available",
      "missing",
      "capture-failed",
      "auth-required",
      "non-get",
      "unsupported-kind",
    ]),
    reason: z.string().nullable(),
    artifact_path: z.string().nullable(),
    captured_at: z.string().nullable(),
  })
  .strict();

const SurfaceFixtureReferenceSchema = z
  .object({
    captured_at: z.iso.datetime().nullable().optional(),
    request: z
      .object({
        method: z.string(),
        url: z.string().nullable(),
      })
      .strict(),
    response: z
      .object({
        status: z.int().nullable(),
        content_type: z.string().nullable().optional(),
      })
      .strict(),
    artifact_path: z.string(),
  })
  .strict();

const AgentCatalogServiceSchema = z
  .object({
    surface_id: z.string(),
    kind: z.string(),
    capability: z.string().optional(),
    description: z.string().nullable().optional(),
    base_url: z.string(),
    provider: z.string().nullable().optional(),
    authority: z.string().nullable().optional(),
    auth_required: z.boolean().optional(),
    schema_url: z.string().nullable().optional(),
    schema_status: z.string().nullable().optional(),
    schema_artifact: z.string().nullable().optional(),
    schema_source: AgentServiceSchemaSourceSchema.nullable().optional(),
    health: z.object({}).passthrough().optional(),
    eligibility: z.object({}).passthrough().optional(),
    fixture: SurfaceFixtureReferenceSchema.optional(),
    fixture_status: AgentServiceFixtureStatusSchema.optional(),
  })
  .passthrough();

export const AgentCatalogSubnetArtifactSchema = ArtifactBaseSchema.extend({
  netuid: z.int().min(0),
  slug: z.string().optional(),
  name: z.string().optional(),
  previously_known_as: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  subnet_type: z.string().nullable().optional(),
  completeness_score: z.number().nullable().optional(),
  integration_readiness: z.int().min(0).max(100).optional(),
  readiness: IntegrationReadinessSchema.optional(),
  agent_readiness: AgentReadinessStatusSchema.optional(),
  service_count: z.int().min(0),
  services: z.array(AgentCatalogServiceSchema),
}).passthrough();
export type AgentCatalogSubnetArtifact = z.infer<
  typeof AgentCatalogSubnetArtifactSchema
>;
export const AgentCatalogSubnetResponseSchema = successEnvelopeSchema(
  AgentCatalogSubnetArtifactSchema,
);

export const AgentResourcesArtifactSchema = ArtifactBaseSchema.extend({
  published_at: z.string().nullable().optional(),
  content_hash: z.string().optional(),
  summary: z
    .object({
      subnet_count: z.int().min(0).optional(),
      callable_service_count: z.int().min(0).optional(),
    })
    .passthrough()
    .optional(),
  copyable_agent: z
    .object({
      title: z.string().optional(),
      url: z.url(),
      description: z.string().optional(),
    })
    .passthrough(),
  mcp: z
    .object({
      endpoint: z.url(),
      transport: z.string().optional(),
      install: z.string(),
      server_card: z.url().optional(),
      tools: z.array(
        z
          .object({
            name: z.string(),
            title: z.string().nullable().optional(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
  resources: z.array(
    z
      .object({
        id: z.string(),
        title: z.string(),
        kind: z.string().optional(),
        url: z.url(),
      })
      .passthrough(),
  ),
}).passthrough();
export type AgentResourcesArtifact = z.infer<
  typeof AgentResourcesArtifactSchema
>;
export const AgentResourcesResponseSchema = successEnvelopeSchema(
  AgentResourcesArtifactSchema,
);
