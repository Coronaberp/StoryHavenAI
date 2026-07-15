"use strict";

const OnboardFlow = { username: null, password: null, backupCodes: null };

const RegisterView = {
  error: "",
  mount(main) {
    this.main = main;
    this.error = "";
    this.render();
  },
  render() {
    const body = `
      <h2 class="font-display font-semibold text-[19px] text-ink mb-1">Bind a new volume</h2>
      <p class="text-[12px] leading-snug text-sec mb-3 font-display italic">Every account here is a volume bound into the archive.</p>
      ${spineStitchHtml(1, 2)}
      ${this.error ? `<div class="mb-3 rounded-lg border border-warn text-warn text-[12.5px] leading-snug px-3 py-2" style="background:color-mix(in srgb, var(--color-warn) 10%, transparent)">${this.error}</div>` : ""}
      ${authField("Username", "username", { ph: "kael" })}
      ${authField("Password", "password", { type: "password", ph: "At least 8 characters" })}
      ${authField("Confirm password", "password2", { type: "password", ph: "Type it again" })}
      <button type="button" data-register-submit class="w-full py-3.5 rounded-xl font-semibold text-[15.5px] text-paper bg-gradient-to-br from-primary to-primary-dark mt-1">
        Bind this volume →
      </button>
      <div class="text-center mt-3">
        <button type="button" data-register-signin class="text-primary text-[13px] font-medium">Already have an account? Sign in</button>
      </div>
    `;
    this.main.innerHTML = heroScene(body);
    this.wire();
  },
  wire() {
    this.main.querySelector("[data-register-submit]").addEventListener("click", () => this.submit());
    this.main.querySelector("[data-register-signin]").addEventListener("click", () => navigate("/login"));
  },
  fieldValue(key) {
    return this.main.querySelector(`[data-field="${key}"]`)?.value?.trim() || "";
  },
  submit() {
    const username = this.fieldValue("username");
    const password = this.fieldValue("password");
    const password2 = this.fieldValue("password2");
    if (username.length < 2) { this.error = "Username must be at least 2 characters."; this.render(); return; }
    if (password.length < 8) { this.error = "Password must be at least 8 characters."; this.render(); return; }
    if (password !== password2) { this.error = "Passwords don't match."; this.render(); return; }
    OnboardFlow.username = username;
    OnboardFlow.password = password;
    OnboardFlow.backupCodes = null;
    navigate("/onboard");
  },
};

if (typeof window !== "undefined") {
  window.OnboardFlow = OnboardFlow;
  window.RegisterView = RegisterView;
}
