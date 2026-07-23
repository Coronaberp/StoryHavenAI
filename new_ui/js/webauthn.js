"use strict";

function _webauthnB64uToBuf(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer;
}

function _webauthnBufToB64u(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function webauthnParseCreationOptions(optionsJson) {
  const options = JSON.parse(optionsJson);
  options.challenge = _webauthnB64uToBuf(options.challenge);
  options.user.id = _webauthnB64uToBuf(options.user.id);
  (options.excludeCredentials || []).forEach((c) => { c.id = _webauthnB64uToBuf(c.id); });
  return options;
}

function webauthnParseRequestOptions(optionsJson) {
  const options = JSON.parse(optionsJson);
  options.challenge = _webauthnB64uToBuf(options.challenge);
  (options.allowCredentials || []).forEach((c) => { c.id = _webauthnB64uToBuf(c.id); });
  return options;
}

function webauthnCredentialToJson(credential) {
  const response = credential.response;
  const out = {
    id: credential.id,
    rawId: _webauthnBufToB64u(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: { clientDataJSON: _webauthnBufToB64u(response.clientDataJSON) },
  };
  if (credential.authenticatorAttachment) out.authenticatorAttachment = credential.authenticatorAttachment;
  if (response.attestationObject) out.response.attestationObject = _webauthnBufToB64u(response.attestationObject);
  if (response.authenticatorData) out.response.authenticatorData = _webauthnBufToB64u(response.authenticatorData);
  if (response.signature) out.response.signature = _webauthnBufToB64u(response.signature);
  if (response.userHandle) out.response.userHandle = _webauthnBufToB64u(response.userHandle);
  if (response.getTransports) out.response.transports = response.getTransports();
  return out;
}

async function webauthnLogin(getOptions = {}) {
  const { challenge_id, options } = await api("/api/auth/webauthn/login/options", { method: "POST" });
  const publicKey = webauthnParseRequestOptions(options);
  const credential = await navigator.credentials.get({ publicKey, ...getOptions });
  return api("/api/auth/webauthn/login/verify", {
    method: "POST",
    body: JSON.stringify({ challenge_id, credential: webauthnCredentialToJson(credential) }),
  });
}

async function webauthnRegister(nickname) {
  const { challenge_id, options } = await api("/api/auth/webauthn/register/options", { method: "POST" });
  const publicKey = webauthnParseCreationOptions(options);
  const credential = await navigator.credentials.create({ publicKey });
  return api("/api/auth/webauthn/register/verify", {
    method: "POST",
    body: JSON.stringify({
      challenge_id,
      nickname: nickname || "",
      transports: credential.response.getTransports ? credential.response.getTransports() : [],
      credential: webauthnCredentialToJson(credential),
    }),
  });
}

function openPasskeySetupGuide(onDone) {
  const layer = openModal(`
    <h3>${t("pk_guide_title", "Sign in with your fingerprint")}</h3>
    <div style="display:flex;flex-direction:column;gap:12px;font-size:13.5px;color:var(--color-sec);line-height:1.55;margin-bottom:14px">
      <p style="margin:0">${t("pk_guide_1", "Next time you sign in, you'll just tap the sign-in box and confirm with your fingerprint, face, or screen-lock PIN - no password to type.")}</p>
      <p style="margin:0">${t("pk_guide_2", "There is nothing to download. Your phone already has this built in - the same lock you use for the phone itself.")}</p>
      <p style="margin:0">${t("pk_guide_3", "When you tap the button below, your phone will ask you to confirm. If a password manager like Bitwarden pops up instead, that works too - either choice is fine.")}</p>
    </div>
    <label class="grimoire-field-label">${t("pk_guide_name_label", "Name this device (optional)")}</label>
    <input type="text" id="pkGuideName" class="grimoire-field-input" placeholder="${t("pk_guide_name_ph", "e.g. My phone")}" style="margin-bottom:16px">
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button type="button" class="pe-gen-btn" id="pkGuideSkip" style="border-color:var(--color-line-2);color:var(--color-sec)">${t("pk_guide_skip", "Not now")}</button>
      <button type="button" class="pe-gen-btn" id="pkGuideGo">${t("pk_guide_go", "Turn it on")}</button>
    </div>
  `);
  layer.querySelector("#pkGuideSkip").onclick = () => closeModal(layer);
  layer.querySelector("#pkGuideGo").onclick = async () => {
    const goBtn = layer.querySelector("#pkGuideGo");
    goBtn.disabled = true;
    try {
      await webauthnRegister(layer.querySelector("#pkGuideName").value.trim());
      closeModal(layer);
      toast(t("pk_guide_done", "Done - next sign-in is just a tap."));
      onDone?.();
    } catch (err) {
      goBtn.disabled = false;
      if (err.name === "NotAllowedError") {
        errorToast(t("pk_guide_cancelled",
          "That was cancelled or timed out before it finished - no passkey was created. Try again, or tap \"Not now\" to skip."));
        return;
      }
      errorToast(err.message || t("pk_guide_failed", "That didn't work - you can try again any time from Settings."));
    }
  };
}

async function maybeOfferPasskeySetup() {
  if (!window.PublicKeyCredential || !ME) return;
  const nudgeKey = `passkeyNudge:${ME.id}`;
  if (store.get(nudgeKey, false)) return;
  store.set(nudgeKey, true);
  let existing;
  try {
    existing = await api("/api/me/passkeys");
  } catch {
    return;
  }
  if (existing.length) return;
  openPasskeySetupGuide();
}

async function webauthnConditionalAvailable() {
  return !!(window.PublicKeyCredential?.isConditionalMediationAvailable
            && await PublicKeyCredential.isConditionalMediationAvailable().catch(() => false));
}
