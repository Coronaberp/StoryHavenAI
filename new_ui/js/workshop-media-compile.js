"use strict";

class WorkshopMediaCompilePanel {
  constructor(forgeView) {
    this.forgeView = forgeView;
    this.items = [];
    this.outputType = "gif";
    this.gifDelay = 500;
    this.gifLoop = true;
    this.gifBoomerang = false;
    this.stripGap = 0;
    this.busy = false;
    this.resultUrl = null;
    this.resultFilename = "";
  }

  addItems(records) {
    for (const r of records) {
      this.items.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, src: r.src });
    }
    this.forgeView.render();
  }

  addFilesFromInput(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(t("forge_couldnt_read_file")));
      reader.readAsDataURL(file);
    }))).then((dataUrls) => {
      this.addItems(dataUrls.map((src) => ({ src })));
    }).catch((err) => errorToast(err.message || t("forge_couldnt_add_files")));
  }

  async openSourcePicker(kind) {
    const endpoint = kind === "creations" ? "/api/imagegen/standalone" : "/api/imagegen/community";
    const title = kind === "creations" ? t("forge_from_my_creations_label") : t("forge_pinacotheca_label");
    const layer = openModal(`<h3>${_esc(title)}</h3><div id="compilePickerGrid" style="margin-top:10px"><p style="font-size:13px;color:var(--color-sec)">${t("forge_loading_label")}</p></div>`, { wide: true });
    let records;
    try {
      records = (await api(endpoint)).filter((r) => r.media_type !== "video");
    } catch (err) {
      layer.querySelector("#compilePickerGrid").innerHTML = `<p style="font-size:13px;color:var(--color-sec)">${_esc(err.message || t("forge_couldnt_load_images"))}</p>`;
      return;
    }
    const selected = new Set();
    const grid = layer.querySelector("#compilePickerGrid");
    const renderGrid = () => {
      if (!records.length) {
        grid.innerHTML = `<p style="font-size:13px;color:var(--color-sec)">${t("forge_nothing_here_yet")}</p>`;
        return;
      }
      grid.innerHTML = `
        <div class="card-grid">
          ${records.map((rec) => `
            <button type="button" data-pick-id="${_attr(rec.id)}" style="position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;border:2px solid ${selected.has(rec.id) ? "var(--color-accent)" : "var(--color-line)"};background:var(--color-surface-2);padding:0;cursor:pointer">
              ${mediaTagHtml(rec, { style: "width:100%;height:100%;object-fit:cover" })}
              ${selected.has(rec.id) ? `<span style="position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:999px;background:var(--color-accent);color:#fff;display:grid;place-items:center;font-size:12px">&check;</span>` : ""}
            </button>
          `).join("")}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:14px">
          <button type="button" class="pe-gen-btn" id="compilePickerConfirm">${t("forge_add_word")} ${selected.size} ${t("forge_selected_word")}</button>
        </div>
      `;
      grid.querySelectorAll("[data-pick-id]").forEach((btn) => {
        btn.onclick = () => {
          const id = btn.dataset.pickId;
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          renderGrid();
        };
      });
      grid.querySelector("#compilePickerConfirm").onclick = () => {
        const chosen = records.filter((rec) => selected.has(rec.id));
        this.addItems(chosen.map((rec) => ({ src: rec.image })));
        closeModal(layer);
      };
    };
    renderGrid();
  }

  moveItem(id, dir) {
    const idx = this.items.findIndex((it) => it.id === id);
    if (idx === -1) return;
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= this.items.length) return;
    [this.items[idx], this.items[swapWith]] = [this.items[swapWith], this.items[idx]];
    this.forgeView.render();
  }

  removeItem(id) {
    this.items = this.items.filter((it) => it.id !== id);
    this.forgeView.render();
  }

  setOutputType(type) { this.outputType = type; this.forgeView.render(); }
  setGifLoop(on) { this.gifLoop = on; }
  setGifBoomerang(on) { this.gifBoomerang = on; }

  loadImageEl(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t("forge_couldnt_load_an_image")));
      img.src = src;
    });
  }

  async buildGifFrames() {
    const imgs = await Promise.all(this.items.map((it) => this.loadImageEl(it.src)));
    const targetW = Math.max(...imgs.map((im) => im.naturalWidth));
    const targetH = Math.max(...imgs.map((im) => im.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    const frames = [];
    for (const img of imgs) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, targetW, targetH);
      const scale = Math.min(targetW / img.naturalWidth, targetH / img.naturalHeight);
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      ctx.drawImage(img, (targetW - w) / 2, (targetH - h) / 2, w, h);
      frames.push(ctx.getImageData(0, 0, targetW, targetH));
    }
    return { frames, width: targetW, height: targetH };
  }

  setResult(blob, filename) {
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
    this.resultUrl = URL.createObjectURL(blob);
    this.resultFilename = filename;
  }

  download() {
    if (!this.resultUrl) return;
    const a = document.createElement("a");
    a.href = this.resultUrl;
    a.download = this.resultFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async compileGif() {
    if (this.items.length < 2 || this.busy) return;
    this.busy = true;
    this.forgeView.render();
    try {
      const { frames, width, height } = await this.buildGifFrames();
      const bytes = await window.GifEncoder.encode({
        width, height, frames,
        delayMs: this.gifDelay, loop: this.gifLoop, boomerang: this.gifBoomerang,
      });
      this.setResult(new Blob([bytes], { type: "image/webp" }), "compiled.webp");
    } catch (err) {
      errorToast(err.message || t("forge_couldnt_compile_animation"));
    }
    this.busy = false;
    this.forgeView.render();
  }

  gifSettingsHtml() {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
        <label style="font-size:12px;color:var(--color-muted)">${t("forge_frame_delay_label")}: <span id="compileGifDelayVal">${this.gifDelay}</span>ms</label>
        <input type="range" id="compileGifDelay" min="50" max="3000" step="50" value="${this.gifDelay}">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-ink)"><input type="checkbox" id="compileGifLoop" ${this.gifLoop ? "checked" : ""}> ${t("forge_loop_forever_label")}</label>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--color-ink)"><input type="checkbox" id="compileGifBoomerang" ${this.gifBoomerang ? "checked" : ""}> ${t("forge_boomerang_label")}</label>
        <button type="button" class="pe-gen-btn" id="compileRunBtn" ${this.items.length < 2 || this.busy ? "disabled" : ""}>${this.busy ? t("forge_compiling_button") : t("forge_compile_webp_button")}</button>
      </div>
    `;
  }

  stripSettingsHtml() {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
        <label style="font-size:12px;color:var(--color-muted)">${t("forge_gap_label")}: <span id="compileStripGapVal">${this.stripGap}</span>px</label>
        <input type="range" id="compileStripGap" min="0" max="40" step="1" value="${this.stripGap}">
        <button type="button" class="pe-gen-btn" id="compileRunBtn" ${!this.items.length || this.busy ? "disabled" : ""}>${this.busy ? t("forge_compiling_button") : t("forge_compile_strip_button")}</button>
      </div>
    `;
  }

  async compileStrip() {
    if (!this.items.length || this.busy) return;
    this.busy = true;
    this.forgeView.render();
    try {
      const imgs = await Promise.all(this.items.map((it) => this.loadImageEl(it.src)));
      const targetW = Math.max(...imgs.map((im) => im.naturalWidth));
      const scaled = imgs.map((im) => ({ img: im, h: im.naturalHeight * (targetW / im.naturalWidth) }));
      const totalH = Math.round(scaled.reduce((sum, s) => sum + s.h, 0) + this.stripGap * Math.max(0, scaled.length - 1));
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = totalH;
      const ctx = canvas.getContext("2d");
      let y = 0;
      for (const s of scaled) {
        ctx.drawImage(s.img, 0, y, targetW, s.h);
        y += s.h + this.stripGap;
      }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      this.setResult(blob, "compiled-strip.png");
    } catch (err) {
      errorToast(err.message || t("forge_couldnt_compile_strip"));
    }
    this.busy = false;
    this.forgeView.render();
  }

  html() {
    const outputChip = (label, val) => `<button type="button" class="filter-chip${this.outputType === val ? " on" : ""}" onclick="_activeForgeView.compile.setOutputType('${val}')">${label}</button>`;
    return `
      <div style="max-width:640px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <button type="button" class="filter-chip" id="compileUploadBtn">${t("forge_upload_images_button")}</button>
          <button type="button" class="filter-chip" onclick="_activeForgeView.compile.openSourcePicker('creations')">${t("forge_from_my_creations_label")}</button>
          <button type="button" class="filter-chip" onclick="_activeForgeView.compile.openSourcePicker('community')">${t("forge_pinacotheca_label")}</button>
          <input type="file" id="compileFileInput" accept="image/*" multiple hidden>
        </div>
        ${this.items.length ? `
          <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;margin-bottom:16px">
            ${this.items.map((it, i) => `
              <div style="position:relative;flex:none;width:84px">
                <img src="${_attr(it.src)}" alt="" style="width:84px;height:84px;object-fit:cover;border-radius:10px;border:1px solid var(--color-line)">
                <div style="display:flex;justify-content:space-between;margin-top:4px">
                  <button type="button" data-move="-1" data-id="${_attr(it.id)}" ${i === 0 ? "disabled" : ""} style="background:none;border:none;color:var(--color-muted);cursor:pointer;padding:2px 4px">${dirMark("&larr;", "&rarr;")}</button>
                  <button type="button" data-remove data-id="${_attr(it.id)}" style="background:none;border:none;color:var(--color-warn);cursor:pointer;padding:2px 4px">&times;</button>
                  <button type="button" data-move="1" data-id="${_attr(it.id)}" ${i === this.items.length - 1 ? "disabled" : ""} style="background:none;border:none;color:var(--color-muted);cursor:pointer;padding:2px 4px">${dirMark("&rarr;", "&larr;")}</button>
                </div>
              </div>
            `).join("")}
          </div>
        ` : `<p style="font-size:13px;color:var(--color-sec);margin-bottom:16px">${t("forge_add_at_least_two_images")}</p>`}
        <div style="display:flex;gap:6px;margin-bottom:16px">
          ${outputChip(t("forge_animated_webp_label"), "gif")}
          ${outputChip(t("forge_vertical_strip_label"), "strip")}
        </div>
        ${this.outputType === "gif" ? this.gifSettingsHtml() : this.stripSettingsHtml()}
        ${this.resultUrl ? `
          <div style="margin-top:18px">
            <img src="${_attr(this.resultUrl)}" alt="" style="max-width:100%;border-radius:12px;border:1px solid var(--color-line)">
            <button type="button" class="pe-gen-btn" id="compileDownloadBtn" style="margin-top:10px">${t("forge_download_button")}</button>
          </div>
        ` : ""}
      </div>
    `;
  }

  wire() {
    const root = this.forgeView.main;
    const uploadBtn = root.querySelector("#compileUploadBtn");
    const fileInput = root.querySelector("#compileFileInput");
    if (uploadBtn && fileInput) {
      uploadBtn.onclick = () => fileInput.click();
      fileInput.onchange = () => { this.addFilesFromInput(fileInput.files); fileInput.value = ""; };
    }
    root.querySelectorAll("[data-move]").forEach((btn) => {
      btn.onclick = () => this.moveItem(btn.dataset.id, Number(btn.dataset.move));
    });
    root.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.onclick = () => this.removeItem(btn.dataset.id);
    });
    const delayEl = root.querySelector("#compileGifDelay");
    if (delayEl) delayEl.oninput = () => {
      this.gifDelay = Number(delayEl.value);
      root.querySelector("#compileGifDelayVal").textContent = this.gifDelay;
    };
    const loopEl = root.querySelector("#compileGifLoop");
    if (loopEl) loopEl.onchange = () => this.setGifLoop(loopEl.checked);
    const boomEl = root.querySelector("#compileGifBoomerang");
    if (boomEl) boomEl.onchange = () => this.setGifBoomerang(boomEl.checked);
    const gapEl = root.querySelector("#compileStripGap");
    if (gapEl) gapEl.oninput = () => {
      this.stripGap = Number(gapEl.value);
      root.querySelector("#compileStripGapVal").textContent = this.stripGap;
    };
    const runBtn = root.querySelector("#compileRunBtn");
    if (runBtn) runBtn.onclick = () => this.outputType === "gif" ? this.compileGif() : this.compileStrip();
    const dlBtn = root.querySelector("#compileDownloadBtn");
    if (dlBtn) dlBtn.onclick = () => this.download();
  }
}

if (typeof window !== "undefined") {
  window.WorkshopMediaCompilePanel = WorkshopMediaCompilePanel;
}
