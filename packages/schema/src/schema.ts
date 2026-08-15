// The schema. Sections follow data-model-spec; 1.0 lands the conventions and
// one worked example, and 1.1 onward land the rest in dependency order.

import { boolean, index, integer, pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import {
  householdId,
  timestamps,
  uuidRef,
  uuidv7Pk,
} from "./conventions.js";

/**
 * The P&L line enum (data-model-spec §3, CLAUDE.md vocabulary lock).
 *
 * Closed at seven values. Taxes is deliberately absent: it is a category
 * named "Taxes After Takehome" filed under fixed_obligations, not a line.
 * The SQL COMMENT ON TYPE in the migration carries this ruling into the
 * database itself so it survives readers who never open this file.
 */
export const plLine = pgEnum("pl_line", [
  "income",
  "fixed_obligations",
  "variable_operating",
  "discretionary",
  "interest_fees",
  "transfer",
  "deployment",
]);

/**
 * categories (data-model-spec §3), the worked example for 1.0.
 *
 * Seeded system categories are is_system; "Gifts received" (pl_line income)
 * is filled by the question machinery and never by detection.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuidv7Pk(),
    householdId: householdId(),
    name: text("name").notNull(),
    plLine: plLine("pl_line").notNull(),
    icon: text("icon"),
    color: text("color"),
    parentId: uuidRef("parent_id"),
    isArchived: boolean("is_archived").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    plaidPfcMappings: text("plaid_pfc_mappings"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index("categories_household_idx").on(t.householdId),
    index("categories_household_pl_line_idx").on(t.householdId, t.plLine),
  ]
);
