// GET /api/v1/profiles, /api/v1/subnets/{netuid}/profile (types-epic B
// batch 10, #8064). {netuid} is a path param, not a query param. Modeled
// from the hand-edited SubnetProfilesArtifact/SubnetProfileArtifact
// components they replace -- both compose sub-shapes already modeled in
// full by earlier batches (SubnetProfile from routes/subnet-profile.ts;
// SubnetDetail/Surface/EndpointResource/CandidateSurface/Gaps from
// routes/subnet-detail.ts), reused directly rather than re-derived.
import { z } from "zod";
import {
  ArtifactBaseSchema,
  CountMapSchema,
  successEnvelopeSchema,
} from "../envelope.ts";
import { SubnetProfileSchema } from "./subnet-profile.ts";
import {
  CandidateSurfaceSchema,
  EndpointResourceSchema,
  GapsSchema,
  SubnetDetailSchema,
  SurfaceSchema,
} from "./subnet-detail.ts";
// subnet-detail.ts's own SubnetDetailSchema.coverage_level uses shared.ts's
// CoverageLevelSchema instance, a separate (structurally identical) object
// from the one registered as "CoverageLevel" (curation-gaps.ts's own
// instance, batch 8/#8062) -- z.toJSONSchema only $refs a field that holds
// the EXACT registered instance, so reusing SubnetDetailSchema as-is here
// would inline coverage_level as a raw enum instead of $ref-ing the
// registered component. Override just that one field with the registered
// instance so SubnetProfileArtifact's `subnet.coverage_level` resolves the
// same way the hand-edited SubnetDetail component it replaces did.
import { CoverageLevelSchema as RegisteredCoverageLevelSchema } from "./curation-gaps.ts";

const SubnetDetailWithRegisteredCoverageLevelSchema = SubnetDetailSchema.extend(
  { coverage_level: RegisteredCoverageLevelSchema },
);

export const SubnetProfilesArtifactSchema = ArtifactBaseSchema.extend({
  profiles: z.array(SubnetProfileSchema),
  summary: z
    .object({
      profile_count: z.int().min(0),
      average_completeness_score: z.int().min(0).max(100),
      native_identity_count: z.int().min(0),
      identity_promotion_candidate_count: z.int().min(0),
      native_identity_unpromoted_count: z.int().min(0),
      by_profile_level: CountMapSchema,
      by_identity_level: CountMapSchema,
      by_confidence: CountMapSchema,
    })
    .strict(),
}).passthrough();
export type SubnetProfilesArtifact = z.infer<
  typeof SubnetProfilesArtifactSchema
>;
export const SubnetProfilesResponseSchema = successEnvelopeSchema(
  SubnetProfilesArtifactSchema,
);

export const SubnetProfileArtifactSchema = ArtifactBaseSchema.extend({
  profile: SubnetProfileSchema,
  subnet: SubnetDetailWithRegisteredCoverageLevelSchema,
  surfaces: z.array(SurfaceSchema),
  endpoints: z.array(EndpointResourceSchema),
  candidate_surfaces: z.array(CandidateSurfaceSchema),
  gaps: GapsSchema,
}).passthrough();
export type SubnetProfileArtifact = z.infer<typeof SubnetProfileArtifactSchema>;
export const SubnetProfileResponseSchema = successEnvelopeSchema(
  SubnetProfileArtifactSchema,
);
