// Fixture loader for MCP/GraphQL parity on GET /api/v1/fixtures/{surface_id}.
// Serves the baked /metagraph/fixtures/{surface_id}.json artifact, resolving
// the surface_id through the same catalog/alias lookup MCP get_fixture uses
// (findSurface + the deprecated surface_id alias index).

import type { StorageReadResult } from "../workers/storage.ts";
import { findSurface } from "./surface-verify.ts";
import { SURFACE_ALIASES_PATH } from "./surface-aliases.ts";

type Row = Record<string, unknown>;
type ReadArtifact = (env: Env, path: string) => Promise<StorageReadResult>;

// surface_id is part of an R2 key path; reject anything that could escape the
// fixtures/ namespace.
export const FIXTURE_SURFACE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export interface FixtureToolError extends Error {
  toolError: true;
  code: string;
}

export function fixtureToolError(
  code: string,
  message: string,
): FixtureToolError {
  const error = new Error(message) as FixtureToolError;
  error.toolError = true;
  error.code = code;
  return error;
}

export function parseFixtureSurfaceId(
  args: Record<string, unknown> | null | undefined,
): string {
  const surfaceId = args?.surface_id;
  if (typeof surfaceId !== "string" || surfaceId.trim() === "") {
    throw fixtureToolError(
      "invalid_params",
      "Argument `surface_id` must be a non-empty string.",
    );
  }
  const normalized = surfaceId.trim();
  if (!FIXTURE_SURFACE_ID_PATTERN.test(normalized)) {
    throw fixtureToolError(
      "invalid_params",
      "surface_id contains invalid characters.",
    );
  }
  return normalized;
}

async function loadOptionalArtifact(
  read: ReadArtifact,
  env: Env,
  path: string,
): Promise<Row | null> {
  const result = await read(env, path);
  return result?.ok ? (result.data as Row) : null;
}

async function resolveFixtureArtifactId(
  read: ReadArtifact,
  env: Env,
  surfaceId: string,
): Promise<string> {
  const catalog = await loadOptionalArtifact(
    read,
    env,
    "/metagraph/operational-surfaces.json",
  );
  const surfaces = Array.isArray(catalog?.surfaces)
    ? (catalog!.surfaces as Row[])
    : [];
  let surface = findSurface(surfaces, surfaceId);
  if (!surface) {
    const aliases = await loadOptionalArtifact(read, env, SURFACE_ALIASES_PATH);
    surface = findSurface(surfaces, surfaceId, aliases);
  }
  return (surface?.surface_id as string) ?? surfaceId;
}

export async function loadFixture(
  ctx: { env: Env; readArtifact: ReadArtifact },
  args: Record<string, unknown> | null | undefined,
  { readArtifact }: { readArtifact?: ReadArtifact } = {},
): Promise<unknown> {
  const surfaceId = parseFixtureSurfaceId(args);
  const read = readArtifact ?? ctx.readArtifact;
  const artifactId = await resolveFixtureArtifactId(read, ctx.env, surfaceId);
  const artifactPath = `/metagraph/fixtures/${artifactId}.json`;
  const result = await read(ctx.env, artifactPath);
  if (!result?.ok) {
    const code =
      (result as { code?: string } | undefined)?.code || "artifact_unavailable";
    if (code === "artifact_not_found") {
      throw fixtureToolError(
        "not_found",
        "No resource at the requested identifier. Use search_subnets or " +
          "list_subnet_apis to discover valid netuids / surface ids.",
      );
    }
    throw fixtureToolError(code, `Could not load ${artifactPath} (${code}).`);
  }
  return result.data;
}
