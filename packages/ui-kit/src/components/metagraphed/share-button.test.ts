import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShareButton } from "@/components/metagraphed/share-button";

// #8467: every masthead renders <ActionBar><ShareButton bare /></ActionBar>
// (~20 pages). `bare` alone keeps the "Share view" label -- only iconOnly
// and connected hide it -- so on a narrow viewport that bordered text pill
// was the widest, loudest element next to the title. The label now hides
// below `sm` in both label-showing variants, leaving just the
// universally-recognized icon; `sm:` and up are unaffected.
const html = (props: React.ComponentProps<typeof ShareButton> = {}) =>
  renderToStaticMarkup(React.createElement(ShareButton, props));

describe("ShareButton label hides below sm (#8467)", () => {
  it("wraps the default variant's label in hidden sm:inline", () => {
    expect(html()).toMatch(/<span class="hidden sm:inline">Share view</);
  });

  it("wraps the bare variant's label in hidden sm:inline", () => {
    expect(html({ bare: true })).toMatch(
      /<span class="hidden sm:inline">Share view</,
    );
  });

  it("tightens the default variant's horizontal padding below sm", () => {
    expect(html()).toContain("px-1.5 sm:px-2.5");
  });

  it("tightens the bare variant's horizontal padding below sm", () => {
    expect(html({ bare: true })).toContain("px-1.5 sm:px-2");
  });

  it("renders no label markup at all for iconOnly/connected (nothing to hide)", () => {
    expect(html({ iconOnly: true })).not.toContain("Share view");
    expect(html({ connected: true })).not.toContain("Share view");
  });

  it("still respects a custom label", () => {
    expect(html({ label: "Share subnet" })).toMatch(
      /<span class="hidden sm:inline">Share subnet</,
    );
  });
});
