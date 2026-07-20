import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  evaluateDeployDrift,
  extractDeployedCommitSha,
  extractDeployedCommitShaFromReleases,
  findPreviousScheduledRunAt,
} from "../scripts/check-worker-deploy-drift.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("extractDeployedCommitSha", () => {
  test("reads the commit hash annotation off the active (first) deployment", () => {
    const sha = extractDeployedCommitSha({
      result: {
        deployments: [
          { id: "dep-2", annotations: { "workers/commit_hash": "abc123" } },
          { id: "dep-1", annotations: { "workers/commit_hash": "old999" } },
        ],
      },
    });
    assert.equal(sha, "abc123");
  });

  test("throws when there are no deployments", () => {
    assert.throws(
      () => extractDeployedCommitSha({ result: { deployments: [] } }),
      /no deployments/,
    );
  });

  test("throws when the active deployment has no commit_hash annotation", () => {
    assert.throws(
      () =>
        extractDeployedCommitSha({
          result: { deployments: [{ id: "dep-1", annotations: {} }] },
        }),
      /no workers\/commit_hash annotation/,
    );
  });
});

describe("extractDeployedCommitShaFromReleases", () => {
  test("returns the most recently-created bare-SHA release version", () => {
    const sha = extractDeployedCommitShaFromReleases([
      { version: SHA_A, dateCreated: "2026-07-18T09:00:00Z" },
      { version: SHA_B, dateCreated: "2026-07-20T09:00:00Z" },
    ]);
    assert.equal(sha, SHA_B);
  });

  test("ignores non-SHA and -preview-suffixed releases", () => {
    const sha = extractDeployedCommitShaFromReleases([
      { version: `${SHA_B}-preview`, dateCreated: "2026-07-21T09:00:00Z" },
      { version: "v1.2.3", dateCreated: "2026-07-20T12:00:00Z" },
      { version: SHA_A, dateCreated: "2026-07-19T09:00:00Z" },
    ]);
    assert.equal(sha, SHA_A);
  });

  test("throws when no release is a bare commit SHA", () => {
    assert.throws(
      () =>
        extractDeployedCommitShaFromReleases([
          { version: "v2.0.0", dateCreated: "2026-07-20T09:00:00Z" },
          { version: `${SHA_A}-preview`, dateCreated: "2026-07-20T09:00:00Z" },
        ]),
      /no release whose version is a bare 40-hex commit SHA/,
    );
  });

  test("tolerates a non-array payload", () => {
    assert.throws(
      () => extractDeployedCommitShaFromReleases(null),
      /no release whose version is a bare 40-hex commit SHA/,
    );
  });
});

describe("findPreviousScheduledRunAt", () => {
  test("returns the most recent completed run excluding the current run", () => {
    const at = findPreviousScheduledRunAt(
      {
        workflow_runs: [
          { id: 3, created_at: "2026-07-14T09:00:00Z" },
          { id: 2, created_at: "2026-07-13T09:00:00Z" },
          { id: 1, created_at: "2026-07-12T09:00:00Z" },
        ],
      },
      3,
    );
    assert.equal(at, "2026-07-13T09:00:00Z");
  });

  test("returns null when there is no prior run", () => {
    const at = findPreviousScheduledRunAt(
      { workflow_runs: [{ id: 1, created_at: "2026-07-14T09:00:00Z" }] },
      1,
    );
    assert.equal(at, null);
  });

  test("tolerates a missing workflow_runs array", () => {
    assert.equal(findPreviousScheduledRunAt({}, 1), null);
  });
});

describe("evaluateDeployDrift", () => {
  test("no alert when the deployed commit matches origin/main HEAD", () => {
    const r = evaluateDeployDrift({
      deployedCommitSha: "abc123",
      mainHeadSha: "abc123",
      mainHeadCommittedAt: "2026-07-14T09:00:00Z",
      previousScheduledRunAt: "2026-07-13T09:00:00Z",
    });
    assert.equal(r.drifted, false);
    assert.equal(r.shouldAlert, false);
  });

  test("no alert on the very first scheduled run ever (no prior run to compare)", () => {
    const r = evaluateDeployDrift({
      deployedCommitSha: "old999",
      mainHeadSha: "abc123",
      mainHeadCommittedAt: "2026-07-14T09:00:00Z",
      previousScheduledRunAt: null,
    });
    assert.equal(r.drifted, true);
    assert.equal(r.shouldAlert, false);
    assert.match(r.reason, /no prior scheduled run/);
  });

  test("no alert when main HEAD was pushed after the previous scheduled run (first run to see it)", () => {
    const r = evaluateDeployDrift({
      deployedCommitSha: "old999",
      mainHeadSha: "abc123",
      mainHeadCommittedAt: "2026-07-14T10:00:00Z",
      previousScheduledRunAt: "2026-07-14T09:00:00Z",
    });
    assert.equal(r.drifted, true);
    assert.equal(r.shouldAlert, false);
    assert.match(r.reason, /first scheduled run to observe/);
  });

  test("alerts once the drift already existed as of the previous scheduled run", () => {
    const r = evaluateDeployDrift({
      deployedCommitSha: "old999",
      mainHeadSha: "abc123",
      mainHeadCommittedAt: "2026-07-12T09:00:00Z",
      previousScheduledRunAt: "2026-07-13T09:00:00Z",
    });
    assert.equal(r.drifted, true);
    assert.equal(r.shouldAlert, true);
    assert.match(r.reason, /persisted across more than one scheduled run/);
  });
});
