"use strict";

class SearchBox {
  constructor({ container, mode, endpoint = null, tokens = [],
                debounceMs = 350, placeholder = "", onChange }) {
    this.container = container;
    this.mode = mode;
    this.endpoint = endpoint;
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

  setState({ query, tokenValues }) {
    if (query !== undefined) this.query = query;
    if (tokenValues !== undefined) this.tokenValues = tokenValues;
    this._render();
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
    const suggestOpen = this.suggestBox.classList.contains("open");
    if (suggestOpen && e.key === "ArrowDown") {
      e.preventDefault();
      this._moveSuggestIndex(1);
      return;
    }
    if (suggestOpen && e.key === "ArrowUp") {
      e.preventDefault();
      this._moveSuggestIndex(-1);
      return;
    }
    if (suggestOpen && e.key === "Escape") {
      this._activeSuggestIndex = -1;
      this.suggestBox.querySelectorAll(".dropdown-item").forEach((el) => el.classList.remove("active"));
      return;
    }
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
      if (suggestOpen && this._activeSuggestIndex >= 0) {
        e.preventDefault();
        this._pickSuggestion(this._activeSuggestIndex);
        return;
      }
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
    const hadFocus = document.activeElement === this.input;
    this._render();
    if (hadFocus) {
      this.input.focus();
      const pos = this.input.value.length;
      this.input.setSelectionRange(pos, pos);
    }
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
    this._suggestMatches = matches;
    this._suggestToken = matchedToken;
    this._activeSuggestIndex = -1;
    this.suggestBox.innerHTML = matches.map((v, i) => `
      <button type="button" class="dropdown-item" data-suggest-index="${i}">${_esc(matchedToken.prefix)}${_esc(v)}</button>
    `).join("");
    this.suggestBox.classList.add("open");
    this.suggestBox.querySelectorAll("[data-suggest-index]").forEach((btn, i) => {
      btn.onclick = () => this._pickSuggestion(i);
    });
  }

  _pickSuggestion(i) {
    this._addTokenValue(this._suggestToken.param, this._suggestMatches[i]);
    this.input.value = "";
    this.query = "";
    this.suggestBox.classList.remove("open");
  }

  _moveSuggestIndex(delta) {
    if (!this._suggestMatches || !this._suggestMatches.length) return;
    const n = this._suggestMatches.length;
    this._activeSuggestIndex = (this._activeSuggestIndex + delta + n) % n;
    this.suggestBox.querySelectorAll(".dropdown-item").forEach((el, i) => {
      el.classList.toggle("active", i === this._activeSuggestIndex);
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
      const separator = this.endpoint.includes("?") ? "&" : "?";
      results = await api(`${this.endpoint}${separator}${params.toString()}`);
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
