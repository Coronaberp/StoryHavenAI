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
    const pills = this._activePills();
    this.container.innerHTML = `
      <div class="search-box" style="position:relative;flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;border:1px solid var(--color-line-2);background:var(--color-surface)">
        ${pills.map((p) => this._pillHtml(p)).join("")}
        <input type="text" class="search-box-input" value="${_attr(this.query)}"
          placeholder="${pills.length ? "" : _attr(this.placeholder || "")}"
          style="flex:1;min-width:70px;border:none;background:none;outline:none;color:var(--color-ink);font-size:13.5px;padding:4px 0">
        <div class="dropdown-menu search-box-suggest" style="left:0;right:0;top:calc(100% + 4px)"></div>
      </div>
    `;
    this.input = this.container.querySelector(".search-box-input");
    this.suggestBox = this.container.querySelector(".search-box-suggest");
    this._activeSuggestIndex = -1;
    this._wireInput();
    this._wirePills();
  }

  _activePills() {
    const pills = [];
    this.tokens.forEach((t) => {
      (this.tokenValues[t.param] || []).forEach((value) => {
        pills.push({ token: t, value });
      });
    });
    return pills;
  }

  _pillHtml(p) {
    return `
      <span class="inline-pill" data-remove-param="${_attr(p.token.param)}" data-remove-value="${_attr(p.value)}">
        ${_esc(p.token.prefix)}${_esc(p.value)}<span class="x" data-pill-remove="1">&times;</span>
      </span>
    `;
  }

  _wirePills() {
    this.container.querySelectorAll("[data-pill-remove]").forEach((x) => {
      x.onclick = (e) => {
        e.stopPropagation();
        const pill = x.closest("[data-remove-param]");
        this._removeTokenValue(pill.dataset.removeParam, pill.dataset.removeValue);
      };
    });
  }

  _removeTokenValue(param, value) {
    this.tokenValues[param] = (this.tokenValues[param] || []).filter((v) => v !== value);
    this._notifyChange();
  }

  _wireInput() {
    this.input.oninput = () => {
      this.query = this.input.value;
      this._updateSuggestions();
      const matchedToken = this._matchedToken(this.query);
      if (matchedToken) return;
      if (this.mode === "client") {
        this._notifyChange();
        return;
      }
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => this._fetchAndNotify(), this.debounceMs);
    };
    this.input.onkeydown = (e) => this._handleKeydown(e);
  }

  _matchedToken(value) {
    return this.tokens.find((t) => value.startsWith(t.prefix));
  }

  _handleKeydown(e) {
    if (e.key === "Backspace" && this.input.value === "") {
      for (let i = this.tokens.length - 1; i >= 0; i--) {
        const param = this.tokens[i].param;
        const values = this.tokenValues[param] || [];
        if (values.length) {
          e.preventDefault();
          this.tokenValues[param] = values.slice(0, -1);
          this._notifyChange();
          return;
        }
      }
      return;
    }
    if (e.key === "Enter") {
      const val = this.input.value.trim();
      const matchedToken = this._matchedToken(val);
      if (matchedToken && val.length > matchedToken.prefix.length) {
        const value = val.slice(matchedToken.prefix.length);
        this._addTokenValue(matchedToken.param, value);
        this.input.value = "";
        this.query = "";
      }
    }
  }

  _addTokenValue(param, value) {
    if (!this.tokenValues[param].includes(value)) {
      this.tokenValues[param] = [...this.tokenValues[param], value];
    }
    this._notifyChange();
  }

  _notifyChange() {
    this._render();
    if (this.mode === "client") {
      this.onChange(this.query, this.tokenValues);
      return;
    }
    this._fetchAndNotify();
  }

  _updateSuggestions() {
    const val = this.input.value;
    const matchedToken = this._matchedToken(val);
    if (!matchedToken) {
      this.suggestBox.classList.remove("open");
      this.suggestBox.innerHTML = "";
      return;
    }
    const partial = val.slice(matchedToken.prefix.length).toLowerCase();
    const already = this.tokenValues[matchedToken.param] || [];
    const matches = matchedToken.suggest(partial)
      .filter((v) => !already.includes(v))
      .slice(0, 8);
    if (!matches.length) {
      this.suggestBox.classList.remove("open");
      this.suggestBox.innerHTML = "";
      return;
    }
    this.suggestBox.innerHTML = matches.map((v, i) => `
      <button type="button" class="dropdown-item" data-suggest-index="${i}">${_esc(matchedToken.prefix)}${_esc(v)}</button>
    `).join("");
    this.suggestBox.classList.add("open");
    this.suggestBox.querySelectorAll("[data-suggest-index]").forEach((btn, i) => {
      btn.onclick = () => {
        this._addTokenValue(matchedToken.param, matches[i]);
        this.input.value = "";
        this.query = "";
        this.suggestBox.classList.remove("open");
      };
    });
  }

  async _fetchAndNotify() {
    const params = new URLSearchParams();
    if (this.query.trim()) params.set("q", this.query.trim());
    this.tokens.forEach((t) => {
      const values = this.tokenValues[t.param] || [];
      if (values.length) params.set(t.param, values.join(","));
    });
    let results;
    try {
      results = await api(`${this.endpoint}?${params.toString()}`);
    } catch (err) {
      toast(err.message || t("search_box_load_error"));
      results = null;
    }
    this.onChange(this.query, this.tokenValues, results);
  }

  destroy() {
    if (this.input) this.input.oninput = null;
    if (this.input) this.input.onkeydown = null;
    clearTimeout(this._debounceTimer);
  }
}
