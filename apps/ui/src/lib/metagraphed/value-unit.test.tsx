import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { normalizeValueUnit, useValueUnit, ValueUnitProvider, type ValueUnit } from "./value-unit";

// renderToStaticMarkup (SSR, no DOM) is enough to exercise a context/hook pair --
// useContext doesn't touch browser APIs. Matches openapi-preload-context.test.tsx's
// "plain node environment" scope; no jsdom/testing-library needed. Effects don't run
// under SSR, so the localStorage rehydrate path (normalizeValueUnit, used inside the
// provider's effect) is covered directly below instead of via a rendered effect.
function Probe({ onValue }: { onValue: (value: ReturnType<typeof useValueUnit>) => void }) {
  onValue(useValueUnit());
  return null;
}

describe("useValueUnit / ValueUnitProvider", () => {
  it("defaults to both outside a provider", () => {
    let captured: ReturnType<typeof useValueUnit> | undefined;
    renderToStaticMarkup(
      <Probe
        onValue={(v) => {
          captured = v;
        }}
      />,
    );
    expect(captured?.unit).toBe("both");
  });

  it("first-load with no stored preference renders the default (both)", () => {
    let captured: ReturnType<typeof useValueUnit> | undefined;
    renderToStaticMarkup(
      <ValueUnitProvider>
        <Probe
          onValue={(v) => {
            captured = v;
          }}
        />
      </ValueUnitProvider>,
    );
    expect(captured?.unit).toBe("both");
  });
});

describe("normalizeValueUnit (localStorage rehydrate validation)", () => {
  it("falls back to the default when nothing is stored", () => {
    expect(normalizeValueUnit(null)).toBe("both");
    expect(normalizeValueUnit(undefined)).toBe("both");
  });

  it("rehydrates a valid stored preference", () => {
    const values: ValueUnit[] = ["tao", "usd", "both"];
    for (const v of values) {
      expect(normalizeValueUnit(v)).toBe(v);
    }
  });

  it("rejects an invalid/corrupt stored value, falling back to the default instead of throwing", () => {
    expect(() => normalizeValueUnit("dollars")).not.toThrow();
    expect(normalizeValueUnit("dollars")).toBe("both");
    expect(normalizeValueUnit("TAO")).toBe("both");
    expect(normalizeValueUnit("")).toBe("both");
    expect(normalizeValueUnit("{not json")).toBe("both");
  });
});
