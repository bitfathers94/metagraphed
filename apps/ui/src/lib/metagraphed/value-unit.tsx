import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ValueUnit = "tao" | "usd" | "both";

const STORAGE_KEY = "mg:value-unit";
const DEFAULT: ValueUnit = "both";

/** 3-way validation of a stored/raw value, falling back to DEFAULT instead of throwing. */
export function normalizeValueUnit(value: string | null | undefined): ValueUnit {
  return value === "tao" || value === "usd" || value === "both" ? value : DEFAULT;
}

interface Ctx {
  unit: ValueUnit;
  setUnit: (u: ValueUnit) => void;
}

const ValueUnitContext = createContext<Ctx>({ unit: DEFAULT, setUnit: () => {} });

/**
 * Provides the τ/USD/Both display preference for money values on the current
 * page. SSR-safe: initial render uses the DEFAULT and rehydrates the persisted
 * choice from localStorage in an effect (so server/client HTML match).
 */
export function ValueUnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnitState] = useState<ValueUnit>(DEFAULT);

  useEffect(() => {
    try {
      setUnitState(normalizeValueUnit(window.localStorage.getItem(STORAGE_KEY)));
    } catch {
      /* storage blocked — keep default */
    }
  }, []);

  const setUnit = (u: ValueUnit) => {
    setUnitState(u);
    try {
      window.localStorage.setItem(STORAGE_KEY, u);
    } catch {
      /* ignore */
    }
  };

  return (
    <ValueUnitContext.Provider value={{ unit, setUnit }}>{children}</ValueUnitContext.Provider>
  );
}

export function useValueUnit() {
  return useContext(ValueUnitContext);
}
