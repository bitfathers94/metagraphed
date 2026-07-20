#!/usr/bin/env node
// Scheduled drift guard (issue #5538, parent epic #4651): the Worker CODE deploys
// via Cloudflare Workers Builds on push to main (a Cloudflare-side git integration,
// not a GitHub Actions step -- see publish-cloudflare.yml's header), so nothing in
// this repo previously verified that a Builds deploy actually landed. A stuck build
// leaves the live Worker silently drifting stale vs. main with no signal here. This
// compares the live deployment's Workers-Builds-linked commit against origin/main
// HEAD and fails the scheduled job once the drift has persisted across a prior
// scheduled run (see evaluateDeployDrift below for the grace-window rule).
import { fileURLToPath } from "node:url";

const DEPLOYMENTS_PATH_TEMPLATE =
  "https://api.cloudflare.com/client/v4/accounts/{accountId}/workers/scripts/{scriptName}/deployments";

// Sentry Releases API for the deployed-commit fallback (issue #7214), using the
// same SENTRY_AUTH_TOKEN secret ui-sentry-release.yml already relies on and its
// jsonbored/metagraphed org/project.
const SENTRY_RELEASES_PATH_TEMPLATE =
  "{baseUrl}/api/0/projects/{org}/{project}/releases/?per_page=100";

// A real deployed release is a bare 40-hex commit SHA (WORKERS_CI_COMMIT_SHA /
// $GITHUB_SHA); PR preview releases are the same SHA with a `-preview` suffix, so
// this shape excludes them without a separate check.
const BARE_COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

export function extractDeployedCommitSha(deploymentsJson) {
  const deployments = deploymentsJson?.result?.deployments;
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error(
      "Cloudflare deployments response contained no deployments for this Worker script",
    );
  }
  const active = deployments[0];
  const commitSha = active?.annotations?.["workers/commit_hash"];
  if (!commitSha) {
    throw new Error(
      `Active deployment ${active?.id ?? "(unknown id)"} has no workers/commit_hash annotation -- Workers Builds may not be linked to git for this script`,
    );
  }
  return commitSha;
}

// Fallback deploy-commit signal (issue #7214): Cloudflare's Deployments API has
// stopped populating the workers/commit_hash annotation even though Workers Builds
// is genuinely deploying on every push, so extractDeployedCommitSha throws and the
// drift check fails every scheduled run. Sentry's release tags reliably carry the
// real deployed git SHA (via @sentry/cloudflare's withSentry(), see
// workers/api.sentry.mjs), so when the Cloudflare annotation is missing we take the
// most recently-created release whose version is a bare 40-hex commit SHA and use
// it as the deployed-commit signal instead. This doesn't fix the underlying
// Cloudflare annotation gap (a dashboard-side git-integration question), only makes
// this check resilient to it.
export function extractDeployedCommitShaFromReleases(releasesJson) {
  const releases = Array.isArray(releasesJson) ? releasesJson : [];
  const commitReleases = releases
    .filter((release) => BARE_COMMIT_SHA_RE.test(release?.version ?? ""))
    .sort(
      (a, b) =>
        new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
    );
  if (commitReleases.length === 0) {
    throw new Error(
      "Sentry returned no release whose version is a bare 40-hex commit SHA -- cannot use it as a deploy-drift fallback signal",
    );
  }
  return commitReleases[0].version;
}

export function findPreviousScheduledRunAt(runsJson, currentRunId) {
  const runs = Array.isArray(runsJson?.workflow_runs)
    ? runsJson.workflow_runs
    : [];
  const previous = runs
    .filter((run) => String(run.id) !== String(currentRunId))
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
  return previous?.created_at ?? null;
}

// Grace window, per issue #5538: skip the very first scheduled run that observes a
// drift (a normal in-flight Builds deploy), only alert once the drift already
// existed as of the PREVIOUS scheduled run -- i.e. it has persisted across a full
// scheduled interval, not just "since the last push". Deliberately time-boundary-
// free (no arbitrary hour threshold): it reuses the scheduled run history GitHub
// Actions already retains instead of inventing separate persisted state.
export function evaluateDeployDrift({
  deployedCommitSha,
  mainHeadSha,
  mainHeadCommittedAt,
  previousScheduledRunAt,
}) {
  if (deployedCommitSha === mainHeadSha) {
    return {
      drifted: false,
      shouldAlert: false,
      reason: `deployed commit ${deployedCommitSha} matches origin/main HEAD`,
    };
  }
  if (!previousScheduledRunAt) {
    return {
      drifted: true,
      shouldAlert: false,
      reason: `origin/main HEAD ${mainHeadSha} (pushed ${mainHeadCommittedAt}) is not yet deployed (live: ${deployedCommitSha}), but there is no prior scheduled run to compare against -- within the grace window`,
    };
  }
  const pushedBeforePreviousRun =
    new Date(mainHeadCommittedAt).getTime() <
    new Date(previousScheduledRunAt).getTime();
  if (!pushedBeforePreviousRun) {
    return {
      drifted: true,
      shouldAlert: false,
      reason: `origin/main HEAD ${mainHeadSha} was pushed after the previous scheduled run (${previousScheduledRunAt}) -- this is the first scheduled run to observe the drift, within the grace window`,
    };
  }
  return {
    drifted: true,
    shouldAlert: true,
    reason: `origin/main HEAD ${mainHeadSha} (pushed ${mainHeadCommittedAt}) is still undeployed (live: ${deployedCommitSha}) as of the previous scheduled run (${previousScheduledRunAt}) -- drift has persisted across more than one scheduled run`,
  };
}

async function main() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const scriptName = process.env.WORKER_SCRIPT_NAME || "metagraphed";
  const mainHeadSha = process.env.MAIN_HEAD_SHA;
  const mainHeadCommittedAt = process.env.MAIN_HEAD_COMMITTED_AT;
  const githubToken = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const workflowFilename = process.env.WORKFLOW_FILENAME;

  if (!accountId || !apiToken) {
    console.error(
      "::error::CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required to check the live Worker deployment -- a contributor PR cannot supply these, a maintainer must configure the repo secrets.",
    );
    return 1;
  }
  if (!mainHeadSha || !mainHeadCommittedAt) {
    console.error(
      "::error::MAIN_HEAD_SHA and MAIN_HEAD_COMMITTED_AT must be set from a fresh checkout before running this check.",
    );
    return 1;
  }

  const deploymentsUrl = DEPLOYMENTS_PATH_TEMPLATE.replace(
    "{accountId}",
    accountId,
  ).replace("{scriptName}", scriptName);
  const deploymentsRes = await fetch(deploymentsUrl, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
  });
  if (deploymentsRes.status === 401 || deploymentsRes.status === 403) {
    console.error(
      `::error::CLOUDFLARE_API_TOKEN lacks permission to read Worker deployments for '${scriptName}' (HTTP ${deploymentsRes.status}). Grant the token Workers Scripts read access -- a contributor PR cannot change token scope, this needs a maintainer.`,
    );
    return 1;
  }
  if (!deploymentsRes.ok) {
    console.error(
      `::error::Cloudflare deployments API returned HTTP ${deploymentsRes.status}: ${await deploymentsRes.text()}`,
    );
    return 1;
  }

  let deployedCommitSha;
  try {
    deployedCommitSha = extractDeployedCommitSha(await deploymentsRes.json());
  } catch (cloudflareError) {
    const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
    if (!sentryAuthToken) {
      console.error(`::error::${cloudflareError.message}`);
      return 1;
    }
    const sentryOrg = process.env.SENTRY_ORG || "jsonbored";
    const sentryProject = process.env.SENTRY_PROJECT || "metagraphed";
    const sentryBaseUrl = process.env.SENTRY_BASE_URL || "https://sentry.io";
    const releasesUrl = SENTRY_RELEASES_PATH_TEMPLATE.replace(
      "{baseUrl}",
      sentryBaseUrl,
    )
      .replace("{org}", sentryOrg)
      .replace("{project}", sentryProject);
    const releasesRes = await fetch(releasesUrl, {
      headers: {
        Authorization: `Bearer ${sentryAuthToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!releasesRes.ok) {
      console.error(
        `::error::${cloudflareError.message}; Sentry releases fallback also failed -- Sentry API returned HTTP ${releasesRes.status}: ${await releasesRes.text()}`,
      );
      return 1;
    }
    try {
      deployedCommitSha = extractDeployedCommitShaFromReleases(
        await releasesRes.json(),
      );
    } catch (sentryError) {
      console.error(
        `::error::${cloudflareError.message}; ${sentryError.message}`,
      );
      return 1;
    }
    console.log(
      `::notice::Cloudflare workers/commit_hash annotation missing -- falling back to Sentry release ${deployedCommitSha} as the deployed-commit signal.`,
    );
  }

  let previousScheduledRunAt = null;
  if (githubToken && repository && workflowFilename) {
    const runsUrl = `https://api.github.com/repos/${repository}/actions/workflows/${workflowFilename}/runs?event=schedule&status=completed&per_page=5`;
    const runsRes = await fetch(runsUrl, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!runsRes.ok) {
      console.error(
        `::error::GitHub Actions API returned HTTP ${runsRes.status} while listing previous scheduled runs: ${await runsRes.text()}`,
      );
      return 1;
    }
    previousScheduledRunAt = findPreviousScheduledRunAt(
      await runsRes.json(),
      runId,
    );
  }

  const result = evaluateDeployDrift({
    deployedCommitSha,
    mainHeadSha,
    mainHeadCommittedAt,
    previousScheduledRunAt,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.shouldAlert) {
    console.error(`::error::${result.reason}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`::error::${error.stack || error.message}`);
      process.exit(1);
    });
}
