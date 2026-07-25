// GET /api/v1/providers, /api/v1/providers/{slug}, /api/v1/providers/{slug}/
// endpoints (types-epic B batch 10, #8064). {slug} is a path param, not a
// query param. Modeled from the hand-edited ProvidersArtifact/ProviderArtifact/
// ProviderEndpointsArtifact components they replace, plus the Provider
// sub-shape (referenced only from these two routes -- verified via
// repo-wide $ref grep -- kept as a plain local const rather than a
// registered component, same orphan treatment as batch 7/8's single-use
// sub-shapes).
import { z } from "zod";
import {
  ArtifactBaseSchema,
  CountMapSchema,
  successEnvelopeSchema,
} from "../envelope.ts";
import { ProviderKindSchema } from "../shared.ts";
import { AuthoritySchema, EndpointResourceSchema } from "./subnet-detail.ts";

const HttpUrlSchema = z.string().regex(/^[Hh][Tt][Tt][Pp][Ss]?:\/\//);

const ProviderSchema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1),
    kind: ProviderKindSchema,
    website_url: HttpUrlSchema,
    docs_url: HttpUrlSchema.optional(),
    github_url: HttpUrlSchema.optional(),
    logo_url: HttpUrlSchema.optional(),
    social: z
      .object({
        x: HttpUrlSchema.optional(),
        telegram: HttpUrlSchema.optional(),
        reddit: HttpUrlSchema.optional(),
        youtube: HttpUrlSchema.optional(),
      })
      .strict()
      .optional(),
    team_url: HttpUrlSchema.optional(),
    contact_url: HttpUrlSchema.optional(),
    authority: AuthoritySchema,
    public_notes: z.string().optional(),
    notes: z.string().optional(),
    netuids: z.array(z.int().min(0)).optional(),
    subnet_count: z.int().min(0).optional(),
    surface_count: z.int().min(0).optional(),
    endpoint_count: z.int().min(0).optional(),
    cluster_id: z.string().optional(),
  })
  .strict();

export const ProvidersArtifactSchema = ArtifactBaseSchema.extend({
  providers: z.array(ProviderSchema),
}).passthrough();
export type ProvidersArtifact = z.infer<typeof ProvidersArtifactSchema>;
export const ProvidersResponseSchema = successEnvelopeSchema(
  ProvidersArtifactSchema,
);

export const ProviderArtifactSchema = ArtifactBaseSchema.extend({
  provider: ProviderSchema,
}).passthrough();
export type ProviderArtifact = z.infer<typeof ProviderArtifactSchema>;
export const ProviderResponseSchema = successEnvelopeSchema(
  ProviderArtifactSchema,
);

export const ProviderEndpointsArtifactSchema = ArtifactBaseSchema.extend({
  provider: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      kind: z.string().optional(),
      authority: z.string().optional(),
    })
    .passthrough(),
  summary: z
    .object({
      endpoint_count: z.int().min(0),
      monitored_count: z.int().min(0),
      pool_eligible_count: z.int().min(0),
      by_kind: CountMapSchema.optional(),
      by_layer: CountMapSchema.optional(),
      by_provider: CountMapSchema.optional(),
      by_publication_state: CountMapSchema.optional(),
      by_status: CountMapSchema.optional(),
    })
    .strict(),
  endpoints: z.array(EndpointResourceSchema),
}).passthrough();
export type ProviderEndpointsArtifact = z.infer<
  typeof ProviderEndpointsArtifactSchema
>;
export const ProviderEndpointsResponseSchema = successEnvelopeSchema(
  ProviderEndpointsArtifactSchema,
);
