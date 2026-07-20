import assert from "node:assert/strict";
import { describe, test } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import {
  FEED_KINDS,
  GET_FEED_OUTPUT_SCHEMA,
  feedMcpError,
  loadFeedItems,
} from "../src/feed-mcp.mjs";
import { FEED_MAX_ITEMS } from "../src/feeds.mjs";

// The five input-validation helpers (requireKind, resolveNetuid,
// optionalTimestampMs, optionalTag, resolveLimit) are module-private, so they
// are exercised through the one public entry point that runs them in order --
// loadFeedItems. Every error path throws before any loader runs, so the
// rejection cases need no functional deps; the accept paths use the shared
// ctx/deps factory below.

const CHANGELOG_ARTIFACT = "/metagraph/changelog.json";
const ENRICHMENT_QUEUE_ARTIFACT = "/metagraph/review/enrichment-queue.json";

// generated_at drives the timestamp of every registry item, so the window
// filters (since/until) key off it -- fixed at mid-day so a bare-date `until`
// of the same day (end-of-day) includes it while an earlier bare date excludes.
const CHANGELOG = {
  generated_at: "2026-06-30T12:00:00.000Z",
  subnets: {
    added: [{ netuid: 5, name: "Alpha", slug: "alpha" }],
    removed: [],
    renamed: [],
  },
  artifacts: {
    added: [{ path: "/metagraph/foo.json" }],
    modified: [],
    removed: [],
  },
  summary: {},
};

const INCIDENTS = {
  surfaces: [
    {
      surface_id: "sn5-axon",
      netuid: 5,
      incidents: [
        {
          started_at: "2026-06-30T10:00:00.000Z",
          ended_at: "2026-06-30T11:00:00.000Z",
          duration_ms: 3_600_000,
          failed_samples: 3,
        },
      ],
    },
    {
      surface_id: "sn9-axon",
      netuid: 9,
      incidents: [{ started_at: "2026-06-30T08:00:00.000Z", duration_ms: 0 }],
    },
  ],
};

const GAPS_QUEUE = {
  generated_at: "2026-06-30T09:00:00.000Z",
  queue: [
    {
      netuid: 7,
      name: "Beta",
      lane: "critical",
      priority_score: 90,
      missing_kinds: ["docs"],
      recommended_action: "Add docs",
    },
  ],
};

function makeCtx() {
  return {
    env: {},
    readArtifact: async (_env, path) => {
      if (path === CHANGELOG_ARTIFACT) return { ok: true, data: CHANGELOG };
      if (path === ENRICHMENT_QUEUE_ARTIFACT)
        return { ok: true, data: GAPS_QUEUE };
      return { ok: false, code: "artifact_not_found" };
    },
  };
}

const DEPS = { loadIncidents: async () => INCIDENTS };

function isInvalidParams(re) {
  return (err) =>
    err.toolError === true &&
    err.code === "invalid_params" &&
    re.test(err.message);
}

describe("feed-mcp", () => {
  test("feedMcpError is shaped for MCP toolError handling", () => {
    const err = feedMcpError("invalid_params", "nope");
    assert.ok(err instanceof Error);
    assert.equal(err.code, "invalid_params");
    assert.equal(err.toolError, true);
    assert.equal(err.message, "nope");
  });

  test("FEED_KINDS lists the four supported feeds", () => {
    assert.deepEqual(FEED_KINDS, ["registry", "incidents", "gaps", "subnet"]);
  });

  describe("requireKind", () => {
    test("rejects a missing kind", async () => {
      await assert.rejects(
        () => loadFeedItems(makeCtx(), {}, DEPS),
        isInvalidParams(/`kind` is required/),
      );
    });

    test("rejects a non-string kind", async () => {
      await assert.rejects(
        () => loadFeedItems(makeCtx(), { kind: 5 }, DEPS),
        isInvalidParams(/`kind` is required/),
      );
    });

    test("rejects a string that is not a valid feed kind", async () => {
      await assert.rejects(
        () => loadFeedItems(makeCtx(), { kind: "bogus" }, DEPS),
        isInvalidParams(/one of: registry, incidents, gaps, subnet/),
      );
    });

    for (const kind of FEED_KINDS) {
      test(`accepts the valid kind \`${kind}\``, async () => {
        const args = kind === "subnet" ? { kind, netuid: 5 } : { kind };
        const out = await loadFeedItems(makeCtx(), args, DEPS);
        assert.equal(out.kind, kind);
      });
    }
  });

  describe("resolveNetuid", () => {
    test("requires netuid when kind is subnet", async () => {
      await assert.rejects(
        () => loadFeedItems(makeCtx(), { kind: "subnet" }, DEPS),
        isInvalidParams(/`netuid` is required.*when kind is `subnet`/),
      );
    });

    test("rejects a negative netuid for subnet", async () => {
      await assert.rejects(
        () => loadFeedItems(makeCtx(), { kind: "subnet", netuid: -1 }, DEPS),
        isInvalidParams(/non-negative integer/),
      );
    });

    test("rejects a non-integer netuid for subnet", async () => {
      await assert.rejects(
        () => loadFeedItems(makeCtx(), { kind: "subnet", netuid: 1.5 }, DEPS),
        isInvalidParams(/non-negative integer/),
      );
    });

    test("accepts a valid netuid for subnet", async () => {
      const out = await loadFeedItems(
        makeCtx(),
        { kind: "subnet", netuid: 5 },
        DEPS,
      );
      assert.equal(out.netuid, 5);
    });

    test("rejects a netuid on a non-subnet kind", async () => {
      await assert.rejects(
        () => loadFeedItems(makeCtx(), { kind: "registry", netuid: 5 }, DEPS),
        isInvalidParams(/only used when kind is `subnet`/),
      );
    });

    test("returns null netuid for a non-subnet kind without one", async () => {
      const out = await loadFeedItems(makeCtx(), { kind: "registry" }, DEPS);
      assert.equal(out.netuid, null);
    });
  });

  describe("optionalTimestampMs", () => {
    test("treats an absent since/until as no bound", async () => {
      const out = await loadFeedItems(makeCtx(), { kind: "registry" }, DEPS);
      assert.equal(out.filters.since, null);
      assert.equal(out.filters.until, null);
      assert.ok(out.returned > 0);
    });

    test("treats an empty-string bound as no bound", async () => {
      const out = await loadFeedItems(
        makeCtx(),
        { kind: "registry", since: "", until: "" },
        DEPS,
      );
      assert.ok(out.returned > 0);
    });

    test("accepts a valid ISO date and a valid ISO date-time", async () => {
      const out = await loadFeedItems(
        makeCtx(),
        {
          kind: "registry",
          since: "2026-06-01",
          until: "2026-06-30T23:59:59Z",
        },
        DEPS,
      );
      assert.ok(out.returned > 0);
    });

    test("rejects a malformed date string", async () => {
      await assert.rejects(
        () =>
          loadFeedItems(makeCtx(), { kind: "registry", since: "nope" }, DEPS),
        isInvalidParams(
          /`since` must be an ISO-8601 date or date-time, e\.g\./,
        ),
      );
    });

    test("rejects a non-string bound", async () => {
      await assert.rejects(
        () => loadFeedItems(makeCtx(), { kind: "registry", until: 123 }, DEPS),
        isInvalidParams(/`until` must be an ISO-8601 date or date-time string/),
      );
    });

    test("a bare-date until is inclusive of the whole UTC day", async () => {
      // Item timestamp is 2026-06-30T12:00Z; until=2026-06-30 resolves to
      // end-of-day so the item survives, but the prior calendar day drops it.
      const kept = await loadFeedItems(
        makeCtx(),
        { kind: "registry", until: "2026-06-30" },
        DEPS,
      );
      assert.ok(kept.returned > 0);

      const dropped = await loadFeedItems(
        makeCtx(),
        { kind: "registry", until: "2026-06-29" },
        DEPS,
      );
      assert.equal(dropped.returned, 0);
    });

    test("a bare-date since is inclusive of the start of that day", async () => {
      const dropped = await loadFeedItems(
        makeCtx(),
        { kind: "registry", since: "2026-07-01" },
        DEPS,
      );
      assert.equal(dropped.returned, 0);
    });
  });

  describe("optionalTag", () => {
    test("treats an absent tag as no filter", async () => {
      const out = await loadFeedItems(makeCtx(), { kind: "registry" }, DEPS);
      assert.equal(out.filters.tag, null);
    });

    test("keeps only items carrying a valid tag", async () => {
      const out = await loadFeedItems(
        makeCtx(),
        { kind: "registry", tag: "artifact" },
        DEPS,
      );
      assert.equal(out.filters.tag, "artifact");
      assert.ok(out.returned > 0);
      assert.ok(out.items.every((it) => it.tags.includes("artifact")));
    });

    test("rejects a non-string tag", async () => {
      await assert.rejects(
        () => loadFeedItems(makeCtx(), { kind: "registry", tag: 7 }, DEPS),
        isInvalidParams(/`tag` must be a string/),
      );
    });
  });

  describe("resolveLimit", () => {
    test("defaults an absent limit to FEED_MAX_ITEMS", async () => {
      const out = await loadFeedItems(makeCtx(), { kind: "registry" }, DEPS);
      assert.equal(out.filters.limit, FEED_MAX_ITEMS);
    });

    test("passes a valid in-range limit through", async () => {
      const out = await loadFeedItems(
        makeCtx(),
        { kind: "registry", limit: 1 },
        DEPS,
      );
      assert.equal(out.filters.limit, 1);
      assert.equal(out.returned, 1);
    });

    test("clamps a limit above FEED_MAX_ITEMS", async () => {
      const out = await loadFeedItems(
        makeCtx(),
        { kind: "registry", limit: 100 },
        DEPS,
      );
      assert.equal(out.filters.limit, FEED_MAX_ITEMS);
    });

    test("rejects a limit below 1", async () => {
      await assert.rejects(
        () => loadFeedItems(makeCtx(), { kind: "registry", limit: 0 }, DEPS),
        isInvalidParams(/`limit` must be an integer between 1 and 50/),
      );
    });

    test("rejects a non-integer limit", async () => {
      await assert.rejects(
        () => loadFeedItems(makeCtx(), { kind: "registry", limit: 2.5 }, DEPS),
        isInvalidParams(/`limit` must be an integer between 1 and 50/),
      );
    });
  });

  describe("loadFeedItems branch dispatch", () => {
    test("registry: builds registry items from the changelog", async () => {
      const out = await loadFeedItems(makeCtx(), { kind: "registry" }, DEPS);
      assert.equal(out.kind, "registry");
      // subnet-added item + artifact-added item, both registry-tagged.
      assert.ok(out.items.some((it) => it.tags.includes("subnet")));
      assert.ok(out.items.some((it) => it.tags.includes("artifact")));
      assert.ok(out.items.every((it) => it.tags.includes("registry")));
    });

    test("registry: degrades to an empty feed when the changelog is unavailable", async () => {
      const ctx = { env: {}, readArtifact: async () => ({ ok: false }) };
      const out = await loadFeedItems(ctx, { kind: "registry" }, DEPS);
      assert.equal(out.returned, 0);
      assert.deepEqual(out.items, []);
    });

    test("incidents: builds items from the injected loadIncidents dep", async () => {
      const out = await loadFeedItems(makeCtx(), { kind: "incidents" }, DEPS);
      assert.equal(out.kind, "incidents");
      assert.ok(out.returned >= 2);
      assert.ok(out.items.every((it) => it.tags.includes("incident")));
    });

    test("gaps: builds items from the enrichment queue via ctx.readArtifact", async () => {
      const out = await loadFeedItems(makeCtx(), { kind: "gaps" }, DEPS);
      assert.equal(out.kind, "gaps");
      assert.equal(out.returned, 1);
      assert.ok(out.items[0].tags.includes("gaps"));
    });

    test("gaps: reads through an injected readArtifact dep", async () => {
      const ctx = { env: {}, readArtifact: async () => ({ ok: false }) };
      const out = await loadFeedItems(
        ctx,
        { kind: "gaps" },
        {
          ...DEPS,
          readArtifact: async (_env, path) =>
            path === ENRICHMENT_QUEUE_ARTIFACT
              ? { ok: true, data: GAPS_QUEUE }
              : { ok: false },
        },
      );
      assert.equal(out.returned, 1);
    });

    test("gaps: degrades to an empty feed when the queue is unavailable", async () => {
      const ctx = { env: {}, readArtifact: async () => ({ ok: false }) };
      const out = await loadFeedItems(ctx, { kind: "gaps" }, DEPS);
      assert.equal(out.returned, 0);
    });

    test("subnet: combines the changelog and incidents for one netuid", async () => {
      const out = await loadFeedItems(
        makeCtx(),
        { kind: "subnet", netuid: 5 },
        DEPS,
      );
      assert.equal(out.kind, "subnet");
      assert.equal(out.netuid, 5);
      // Only sn5 items survive the netuid filter: the registry subnet-add for 5
      // and its one incident -- sn9's incident is excluded.
      assert.ok(out.items.some((it) => it.tags.includes("subnet")));
      assert.ok(out.items.some((it) => it.tags.includes("incident")));
      assert.ok(out.items.every((it) => !it.tags.includes("sn9")));
    });
  });

  test("loadFeedItems output validates against GET_FEED_OUTPUT_SCHEMA", async () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(GET_FEED_OUTPUT_SCHEMA);
    const out = await loadFeedItems(makeCtx(), { kind: "registry" }, DEPS);
    assert.ok(validate(out), JSON.stringify(validate.errors));
  });
});
