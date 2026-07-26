"use strict";

const PAGINATE_DEFAULT_SIZE = 10;
const _paginatePages = {};
const _paginateRenderers = {};

function paginateKeyFor(label) {
  return String(label || "list").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function paginateSlice(key, items, pageSize = PAGINATE_DEFAULT_SIZE) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(_paginatePages[key] || 1, pages);
  _paginatePages[key] = page;
  const start = (page - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), page, pages, total, start, pageSize };
}

function paginationHtml(key, state) {
  if (state.pages < 2) return "";
  const from = state.start + 1;
  const to = state.start + state.rows.length;
  const step = (dir, disabled, glyph, label) => `
    <button type="button" data-paginate="${_attr(key)}" data-paginate-dir="${dir}" class="paginate-step"${disabled ? " disabled" : ""} aria-label="${_attr(label)}">${glyph}</button>
  `;
  return `
    <div class="paginate-bar">
      ${step("prev", state.page === 1, "&lsaquo;", t("paginate_previous", "Previous page"))}
      <span class="paginate-count">${from}-${to} ${t("paginate_of", "of")} ${state.total}</span>
      ${step("next", state.page === state.pages, "&rsaquo;", t("paginate_next", "Next page"))}
    </div>
  `;
}

function onPaginate(key, render) {
  _paginateRenderers[key] = render;
}

function paginatePage(key) {
  return _paginatePages[key] || 1;
}

function resetPagination(key) {
  _paginatePages[key] = 1;
}

document.addEventListener("click", (e) => {
  const button = e.target.closest?.("[data-paginate]");
  if (!button || button.disabled) return;
  e.preventDefault();
  e.stopPropagation();
  const key = button.dataset.paginate;
  const next = (_paginatePages[key] || 1) + (button.dataset.paginateDir === "next" ? 1 : -1);
  _paginatePages[key] = Math.max(1, next);
  _paginateRenderers[key]?.();
}, true);

if (typeof window !== "undefined") {
  window.paginateSlice = paginateSlice;
  window.paginationHtml = paginationHtml;
  window.paginateKeyFor = paginateKeyFor;
  window.onPaginate = onPaginate;
  window.resetPagination = resetPagination;
  window.paginatePage = paginatePage;
}
