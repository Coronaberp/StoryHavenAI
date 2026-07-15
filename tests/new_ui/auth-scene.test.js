import { test } from "node:test";
import assert from "node:assert/strict";
import { spineStitchHtml } from "../../new_ui/js/auth-scene.js";

test("spineStitchHtml marks steps up to and including the current one as filled", () => {
  const html = spineStitchHtml(1, 2);
  const filledCount = (html.match(/data-stitch-filled/g) || []).length;
  assert.equal(filledCount, 1);
});

test("spineStitchHtml marks all steps filled on the final step", () => {
  const html = spineStitchHtml(2, 2);
  const filledCount = (html.match(/data-stitch-filled/g) || []).length;
  assert.equal(filledCount, 2);
});
