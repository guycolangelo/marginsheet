import { describe, it, expect } from "vitest";
import {
  COMMITMENT_SOURCE_AUTHORITY,
  overrides,
  type CommitmentSource,
} from "../src/commitments.js";

describe("commitment source authority", () => {
  it("is strictly ascending in the spec's order", () => {
    const order = Object.entries(COMMITMENT_SOURCE_AUTHORITY);
    expect(order.map(([k]) => k)).toEqual([
      "plaid_recurring",
      "census",
      "liability_detail",
      "household_stated",
    ]);
    const values = order.map(([, v]) => v);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });

  it("household_stated always wins, matching local-always-wins", () => {
    const others: CommitmentSource[] = ["plaid_recurring", "census", "liability_detail"];
    for (const other of others) {
      expect(overrides("household_stated", other), other).toBe(true);
      expect(overrides(other, "household_stated"), other).toBe(false);
    }
  });

  it("plaid_recurring never overrides anything above it", () => {
    for (const higher of ["census", "liability_detail", "household_stated"] as const) {
      expect(overrides("plaid_recurring", higher), higher).toBe(false);
    }
  });

  it("a fresher fact from the same source still overwrites", () => {
    for (const source of Object.keys(COMMITMENT_SOURCE_AUTHORITY) as CommitmentSource[]) {
      expect(overrides(source, source), source).toBe(true);
    }
  });
});
