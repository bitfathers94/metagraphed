import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExternalLink, safeExternalUrl } from "./external-link";

describe("safeExternalUrl", () => {
  it("allows ordinary public http(s) URLs", () => {
    expect(safeExternalUrl("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
    expect(safeExternalUrl("http://docs.example.com/")).toBe(
      "http://docs.example.com/",
    );
  });

  it("blocks non-http schemes and credentialed URLs", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalUrl("data:text/html,hi")).toBeUndefined();
    expect(safeExternalUrl("https://user:pass@example.com/")).toBeUndefined();
  });

  it("blocks private, reserved, and local host targets", () => {
    const unsafe = [
      "http://localhost/",
      "http://service.local/",
      "http://0.0.0.0/",
      "http://10.0.0.1/",
      "http://100.64.0.1/",
      "http://127.0.0.1/",
      "http://169.254.169.254/",
      "http://172.16.0.1/",
      "http://192.0.2.1/",
      "http://192.168.0.1/",
      "http://198.18.0.1/",
      "http://198.51.100.1/",
      "http://203.0.113.1/",
      "http://224.0.0.1/",
      "http://[::1]/",
      "http://[::ffff:7f00:1]/",
      "http://[fc00::1]/",
      "http://[fe80::1]/",
      "http://[ff02::1]/",
    ];

    for (const href of unsafe) {
      expect(safeExternalUrl(href), href).toBeUndefined();
    }
  });
});

describe("ExternalLink children wrapper (#8537)", () => {
  it("gives the children wrapper span both min-w-0 and truncate", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ExternalLink, {
        href: "https://example.com/",
        children:
          "a very long label that should truncate instead of escaping the flex row",
      }),
    );
    const wrapperMatch = markup.match(/<span class="[^"]*">/);
    expect(wrapperMatch).not.toBeNull();
    const wrapperTag = wrapperMatch![0];
    expect(wrapperTag).toContain("min-w-0");
    expect(wrapperTag).toContain("truncate");
  });
});
