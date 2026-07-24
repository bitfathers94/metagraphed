import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// SubnetWindowProvider reads/writes the URL via @tanstack/react-router's
// useNavigate/useSearch, which need a live router to resolve outside a
// RouterProvider. Mocked here so the provider can be exercised in this
// suite's plain node environment (renderToStaticMarkup, no jsdom/testing-
// library), matching the api-source-context/openapi-preload-context tests.
const mockNavigate = vi.fn();
let mockSearchValue: Record<string, unknown> = {};
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearchValue,
}));

const { isSubnetWindow, SubnetWindowProvider, useSubnetWindow } = await import("./subnet-window");

function Probe({ onValue }: { onValue: (value: ReturnType<typeof useSubnetWindow>) => void }) {
  onValue(useSubnetWindow());
  return null;
}

describe("isSubnetWindow", () => {
  it("accepts the three valid windows", () => {
    expect(isSubnetWindow("7d")).toBe(true);
    expect(isSubnetWindow("30d")).toBe(true);
    expect(isSubnetWindow("90d")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isSubnetWindow("1d")).toBe(false);
    expect(isSubnetWindow("")).toBe(false);
    expect(isSubnetWindow(undefined)).toBe(false);
    expect(isSubnetWindow(null)).toBe(false);
    expect(isSubnetWindow(30)).toBe(false);
    expect(isSubnetWindow({})).toBe(false);
  });
});

describe("useSubnetWindow", () => {
  it("falls back to 30d with a no-op setter outside a provider", () => {
    let captured: ReturnType<typeof useSubnetWindow> | undefined;
    renderToStaticMarkup(
      <Probe
        onValue={(v) => {
          captured = v;
        }}
      />,
    );

    expect(captured?.window).toBe("30d");
    expect(() => captured?.setWindow("7d")).not.toThrow();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("reads the window from the URL search param inside a provider", () => {
    mockSearchValue = { window: "7d" };
    let captured: ReturnType<typeof useSubnetWindow> | undefined;
    renderToStaticMarkup(
      <SubnetWindowProvider>
        <Probe
          onValue={(v) => {
            captured = v;
          }}
        />
      </SubnetWindowProvider>,
    );

    expect(captured?.window).toBe("7d");
  });

  it("falls back to defaultWindow inside a provider when the search param is missing or invalid", () => {
    mockSearchValue = { window: "bogus" };
    let captured: ReturnType<typeof useSubnetWindow> | undefined;
    renderToStaticMarkup(
      <SubnetWindowProvider defaultWindow="90d">
        <Probe
          onValue={(v) => {
            captured = v;
          }}
        />
      </SubnetWindowProvider>,
    );

    expect(captured?.window).toBe("90d");
  });

  it("setWindow navigates in place, merging the new window into the existing search params", () => {
    mockSearchValue = { window: "30d", foo: "bar" };
    let captured: ReturnType<typeof useSubnetWindow> | undefined;
    renderToStaticMarkup(
      <SubnetWindowProvider>
        <Probe
          onValue={(v) => {
            captured = v;
          }}
        />
      </SubnetWindowProvider>,
    );

    captured?.setWindow("7d");

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0];
    expect(call.to).toBe(".");
    expect(call.replace).toBe(true);
    expect(call.resetScroll).toBe(false);
    expect(call.search({ foo: "bar" })).toEqual({ foo: "bar", window: "7d" });
  });
});
