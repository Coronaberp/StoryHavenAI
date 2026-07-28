"use strict";

class SearchBox {
  constructor({ container, mode, endpoint = null, dataSource = null, tokens = [],
                debounceMs = 350, placeholder = "", onChange }) {
    this.container = container;
    this.mode = mode;
    this.endpoint = endpoint;
    this.dataSource = dataSource;
    this.tokens = tokens;
    this.debounceMs = debounceMs;
    this.placeholder = placeholder;
    this.onChange = onChange;
    this.query = "";
    this.tokenValues = {};
    tokens.forEach((t) => { this.tokenValues[t.param] = []; });
    this._debounceTimer = null;
    this._render();
  }

  getState() {
    return { query: this.query, tokenValues: { ...this.tokenValues } };
  }

  _render() {
    this.container.innerHTML = `
      <div class="search-box" style="position:relative;flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface)">
        <input type="text" class="search-box-input" placeholder="${_attr(this.placeholder || "")}"
          style="flex:1;min-width:70px;border:none;background:none;outline:none;color:var(--color-ink);font-size:13.5px;padding:4px 0">
        <div class="dropdown-menu search-box-suggest" style="left:0;right:0;top:calc(100% + 4px)"></div>
      </div>
    `;
    this.input = this.container.querySelector(".search-box-input");
    this._wireInput();
  }

  _wireInput() {
    this.input.oninput = () => {
      this.query = this.input.value;
      if (this.mode === "client") {
        this.onChange(this.query, this.tokenValues);
        return;
      }
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => this._fetchAndNotify(), this.debounceMs);
    };
  }

  async _fetchAndNotify() {
    const params = new URLSearchParams();
    if (this.query.trim()) params.set("q", this.query.trim());
    const results = await api(`${this.endpoint}?${params.toString()}`);
    this.onChange(this.query, this.tokenValues, results);
  }

  destroy() {
    if (this.input) this.input.oninput = null;
    clearTimeout(this._debounceTimer);
  }
}
