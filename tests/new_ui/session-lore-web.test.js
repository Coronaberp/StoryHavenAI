import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sessionLoreCategoryColor,
  sessionLoreDegreeMap,
  sessionLoreNodeRadius,
} from "../../new_ui/js/session-lore-web.js";

const PALETTE = [
  { bg: "#111111", border: "#222222" },
  { bg: "#333333", border: "#444444" },
];

test("sessionLoreCategoryColor is deterministic for the same category", () => {
  const a = sessionLoreCategoryColor("Locations", PALETTE);
  const b = sessionLoreCategoryColor("Locations", PALETTE);
  assert.deepEqual(a, b);
});

test("sessionLoreCategoryColor picks a palette entry", () => {
  const result = sessionLoreCategoryColor("Factions", PALETTE);
  assert.ok(PALETTE.includes(result));
});

test("sessionLoreDegreeMap counts edges touching each entry", () => {
  const entries = [
    { id: "a", links: [{ target_id: "b", label: "" }] },
    { id: "b", links: [] },
    { id: "c", links: [] },
  ];
  const degree = sessionLoreDegreeMap(entries);
  assert.equal(degree.a, 1);
  assert.equal(degree.b, 1);
  assert.equal(degree.c, 0);
});

test("sessionLoreDegreeMap ignores edges to entries outside the set", () => {
  const entries = [
    { id: "a", links: [{ target_id: "missing", label: "" }] },
  ];
  const degree = sessionLoreDegreeMap(entries);
  assert.equal(degree.a, 0);
});

test("sessionLoreNodeRadius grows with degree and caps at 40", () => {
  assert.equal(sessionLoreNodeRadius(0), 18);
  assert.equal(sessionLoreNodeRadius(2), 26);
  assert.equal(sessionLoreNodeRadius(100), 40);
});
