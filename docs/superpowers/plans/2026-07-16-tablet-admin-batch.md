# Phase 1 / Admin Batch: Tablet Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:dispatching-parallel-agents to implement this plan — all 8 tasks touch independent files with no shared state and can run as parallel agent dispatches. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the established `.content-col` capped-and-centered pattern to all 8 Admin screens.

**Architecture:** `.content-col` already exists in `new_ui/css/cards.css` (680px cap, centered, `≥768px`). Wrap each screen's root render output in a `<div class="content-col">...</div>`.

## Global Constraints

- Cap width: 680px via the existing `.content-col` class — do not redefine it.
- Applies at `≥768px` only — mobile behavior must be unchanged.
- **This batch does NOT convert admin's card-stacked user/job/moderation rows into real `<table>` layouts** — that's a separate, per-screen design decision (columns differ per screen) deferred to a future follow-up, same reasoning as excluding Chat from the Create/Chat batch. This batch is capping-only.
- Zero comments in code.
- Verify with Python's `playwright` package directly against the running `:3001` dev server (no browser MCP tool available) — do NOT start or restart any dev server. Login: `claude` / `0987654321` (already an admin/dev account — admin routes should be reachable).

---

### Task 1: Cap Admin Overview (`AdminOverviewView`)
**Files:** Modify `new_ui/js/admin.js:76` (`render()`)
- [ ] Wrap the `this.main.innerHTML` template literal's full content in `.content-col`.
- [ ] Verify at `/admin`, 375×900 (unchanged) and 800×900 (680px capped/centered).
- [ ] Commit: `git add new_ui/js/admin.js && git commit -m "Cap Admin Overview to content column at tablet width"`

### Task 2: Cap Admin Users (`AdminUsersView`)
**Files:** Modify `new_ui/js/admin-users.js:63` (`render()`)
- [ ] Wrap the `this.main.innerHTML` template literal's full content in `.content-col`.
- [ ] Verify at `/admin/users`, 375×900 (unchanged) and 800×900 (680px capped/centered), user rows/action buttons not clipped.
- [ ] Commit: `git add new_ui/js/admin-users.js && git commit -m "Cap Admin Users to content column at tablet width"`

### Task 3: Cap Admin Moderation (`AdminModerationView`)
**Files:** Modify `new_ui/js/admin-moderation.js:385` (`AdminModerationView.prototype.render = function () {...}`)
- [ ] Wrap the `this.main.innerHTML` template literal's full content in `.content-col`.
- [ ] Verify at `/admin/moderation`, 375×900 (unchanged) and 800×900 (680px capped/centered).
- [ ] Commit: `git add new_ui/js/admin-moderation.js && git commit -m "Cap Admin Moderation to content column at tablet width"`

### Task 4: Cap Admin Previews (`AdminPreviewsView`)
**Files:** Modify `new_ui/js/admin-previews.js:95` (`render()`)
- [ ] Wrap the `this.main.innerHTML` template literal's full content in `.content-col`.
- [ ] Verify at `/admin/previews`, 375×900 (unchanged) and 800×900 (680px capped/centered), checkpoint/LoRA preview grids not clipped.
- [ ] Commit: `git add new_ui/js/admin-previews.js && git commit -m "Cap Admin Previews to content column at tablet width"`

### Task 5: Cap Admin Train (`AdminTrainView`)
**Files:** Modify `new_ui/js/admin-train.js:95` (`render()`)
- [ ] Wrap the `this.main.innerHTML` template literal's full content in `.content-col`. Note: this file has multiple `render*` methods (`renderCheckpointPickerGrid`, `renderMetricsTable`, `renderTransferTable`, `renderLossChart`) — only touch the main `render()` at line 95 that sets `this.main.innerHTML`, leave the others untouched.
- [ ] Verify at `/admin/train`, 375×900 (unchanged) and 800×900 (680px capped/centered), job cards/charts not clipped.
- [ ] Commit: `git add new_ui/js/admin-train.js && git commit -m "Cap Admin Train to content column at tablet width"`

### Task 6: Cap Admin Emojis (`AdminEmojisView`)
**Files:** Modify `new_ui/js/admin-emojis.js:44` (`render()`)
- [ ] Wrap the `this.main.innerHTML` template literal's full content in `.content-col`.
- [ ] Verify at `/admin/emojis`, 375×900 (unchanged) and 800×900 (680px capped/centered), emoji grid not clipped.
- [ ] Commit: `git add new_ui/js/admin-emojis.js && git commit -m "Cap Admin Emojis to content column at tablet width"`

### Task 7: Cap Admin Config (`AdminConfigView`)
**Files:** Modify `new_ui/js/admin-config.js:282` (`AdminConfigView.prototype.render = function () {...}`)
- [ ] Wrap the `this.main.innerHTML` template literal's full content in `.content-col`.
- [ ] Verify at `/admin/config`, 375×900 (unchanged) and 800×900 (680px capped/centered), config form fields not clipped.
- [ ] Commit: `git add new_ui/js/admin-config.js && git commit -m "Cap Admin Config to content column at tablet width"`

### Task 8: Cap Admin Health (`AdminHealthView`)
**Files:** Modify `new_ui/js/admin-health.js:141` (`AdminHealthView.prototype.render = function () {...}`)
- [ ] Wrap the `this.main.innerHTML` template literal's full content in `.content-col`. Note: this file also has `renderChart(service)` and `renderHealth()` methods — only touch the main `render()` at line 141 that sets `this.main.innerHTML`, leave the others untouched.
- [ ] Verify at `/admin/health`, 375×900 (unchanged) and 800×900 (680px capped/centered), health cards/charts not clipped.
- [ ] Commit: `git add new_ui/js/admin-health.js && git commit -m "Cap Admin Health to content column at tablet width"`

---

## Self-Review Notes

- Spec coverage: all 8 Admin routes covered, one task each.
- No new CSS — reuses `.content-col` from the Browse batch.
- All 8 tasks are file-independent — safe for parallel dispatch.
- **Before committing, each agent must run `git status` on its target file first** — this repo has had several instances this session of pre-existing unrelated uncommitted work sitting in files before a batch started; only stage the `.content-col` wrap, never a blanket `git add` without checking diff scope first.
