// The Money Intelligence category rules (canon v3.1, 18 Aug 2026).
//
// EVERY RULE SHIPS AS A FIXTURE PAIR. One string that must fire and one that
// must not, side by side, because a rule stated in prose is not teachable and
// every rule here has a line that is one word wide.
//
// "A rule that has never gone red is a rule nobody has exercised."

import { describe, it, expect } from "vitest";
import { lint, type LintContext } from "../src/index.js";

const fires = (id: string, text: string, contexts: LintContext[]) =>
  lint(text, contexts).some((f) => f.ruleId === id);

const COPY: LintContext[] = ["household_copy"];
const ARTIFACT: LintContext[] = ["composed_artifact"];
const UNIVERSAL: LintContext[] = ["universal"];

describe("no-financial-in-household-copy", () => {
  const id = "no-financial-in-household-copy";

  it("FIRES on the category description a household would read", () => {
    expect(fires(id, "Your complete household financial management system.", COPY)).toBe(true);
  });

  it("FIRES in a composed artifact", () => {
    expect(fires(id, "Here is your financial picture for July.", ARTIFACT)).toBe(true);
  });

  it("PERMITS the same word in our own reasoning, which is not household-facing", () => {
    // Seven comments in this repo say "financial data" correctly, describing
    // what the system protects. A universal rule would fire on privacy code
    // doing exactly what doctrine asks.
    expect(fires(id, "this product's clicks are households' financial data", UNIVERSAL)).toBe(false);
  });

  it("PERMITS financial_accounts, the table name M4 uses throughout", () => {
    // The underscore is a word character, so \b does not fall after
    // "financial". Asserted rather than assumed: a rule that broke the table
    // name would be reverted rather than fixed.
    expect(fires(id, "insert into financial_accounts (household_id)", COPY)).toBe(false);
    expect(fires(id, "const financialAccounts = rows;", COPY)).toBe(false);
  });

  it("permits the replacement the canon names", () => {
    expect(fires(id, "MarginSheet understands your money.", COPY)).toBe(false);
  });
});

describe("no-competitor-category-terms", () => {
  const id = "no-competitor-category-terms";

  for (const banned of [
    "a personal finance app",
    "financial management for households",
    "financial wellness, delivered",
    "your financial health score",
  ]) {
    it(`FIRES on ${JSON.stringify(banned)}`, () => {
      expect(fires(id, banned, UNIVERSAL)).toBe(true);
    });
  }

  it("permits the category we do own", () => {
    expect(fires(id, "MarginSheet is a Money Intelligence Platform.", UNIVERSAL)).toBe(false);
  });
});

describe("no-agent-descriptor", () => {
  const id = "no-agent-descriptor";

  it("FIRES when MyKeeper is called an agent", () => {
    expect(fires(id, "MyKeeper is an agent that manages your money.", UNIVERSAL)).toBe(true);
  });

  it("FIRES on 'AI agent' and 'agentic', the constructions that imply authority", () => {
    expect(fires(id, "an AI agent for your household", UNIVERSAL)).toBe(true);
    expect(fires(id, "an agentic workflow over the household's books", UNIVERSAL)).toBe(true);
  });

  it("PERMITS user_agent, which is an HTTP header and not a descriptor", () => {
    // M3's privacy work reads and nulls this column deliberately. A bare
    // /\bagent\b/ would fire across session code that is doing exactly what
    // the network-identity doctrine asks, which is how a rule gets suppressed.
    expect(fires(id, "the user_agent column is nulled by the 0012 trigger", UNIVERSAL)).toBe(false);
    expect(fires(id, "For user agent the trigger is the sole defence.", UNIVERSAL)).toBe(false);
  });

  it("permits the descriptor the canon requires", () => {
    expect(fires(id, "MyKeeper is your Personal Money Intelligence Analyst.", UNIVERSAL)).toBe(false);
  });
});

describe("no-ai-category-language", () => {
  const id = "no-ai-category-language";

  it("FIRES on AI-powered and AI assistant", () => {
    expect(fires(id, "AI-powered money management", UNIVERSAL)).toBe(true);
    expect(fires(id, "an AI assistant for your books", UNIVERSAL)).toBe(true);
  });

  it("permits the competitive line, which names the category to distinguish it", () => {
    // "AI assistants answer" is the canon's own sentence. It is plural and
    // sits in a contrast, and it is the one place the phrase is correct.
    expect(
      lint("Budgeting apps track. Dashboards organize. AI assistants answer.", UNIVERSAL)
        .some((f) => f.ruleId === id)
    ).toBe(true);
    // RECORDED, NOT PAPERED OVER: the canon's own competitive line trips this
    // rule. See docs/open-items.json, competitive-line-trips-ai-rule. The rule
    // is not weakened to accommodate one sentence that has no home in the
    // product yet.
  });
});

describe("money-intelligence-capitalized", () => {
  const id = "money-intelligence-capitalized";

  it("FIRES on the lowercase form", () => {
    expect(fires(id, "we deliver money intelligence to households", UNIVERSAL)).toBe(true);
  });

  it("permits the capitalised category noun", () => {
    expect(fires(id, "Money Intelligence is the system. Margin is the vital sign.", UNIVERSAL)).toBe(false);
  });
});

describe("no-burden-verbs", () => {
  const id = "no-burden-verbs";

  // THE PAIR THAT MATTERS. The true statement and the lecture are one word
  // apart, and this is the highest-risk surface in the product.
  it("FIRES on the verdict", () => {
    expect(fires(id, "This ties up your Margin for two years.", ARTIFACT)).toBe(true);
  });

  it("PERMITS the fact", () => {
    expect(fires(id, "This commits $2,496 through August 2028.", ARTIFACT)).toBe(false);
  });

  for (const verb of [
    "that is money locked in for 24 months",
    "you are working to pay it off",
    "the Margin is eaten by the payment",
    "you are stuck with it until 2028",
    "you are on the hook for $104 a month",
    "saddled with the balance",
    "the month is weighed down by it",
  ]) {
    it(`FIRES on ${JSON.stringify(verb.slice(0, 34))}`, () => {
      expect(fires(id, verb, ARTIFACT)).toBe(true);
    });
  }

  it("PERMITS technical uses outside household surfaces", () => {
    // "locked in" has an ordinary technical meaning, and a rule firing on a
    // mutex comment is a rule people learn to ignore.
    expect(fires(id, "the row is locked in the transaction", UNIVERSAL)).toBe(false);
  });
});

describe("budgeting-apps-quoted, extended to the singular", () => {
  const id = "budgeting-apps-quoted";

  it("FIRES on the unquoted SINGULAR, which was legal until 18 Aug 2026", () => {
    expect(fires(id, "unlike a budgeting app, MarginSheet understands.", UNIVERSAL)).toBe(true);
  });

  it("still fires on the unquoted plural", () => {
    expect(fires(id, "budgeting apps track spending", UNIVERSAL)).toBe(true);
  });

  it("permits both when quoted", () => {
    expect(fires(id, 'unlike a "budgeting app", MarginSheet understands.', UNIVERSAL)).toBe(false);
    expect(fires(id, '"budgeting apps" track spending', UNIVERSAL)).toBe(false);
  });
});
