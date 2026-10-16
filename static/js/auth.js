function setAuthTab(m){
  authMode = m;
  document.getElementById("authTabLogin").classList.toggle("active", m === "login");
  document.getElementById("authTabReg").classList.toggle("active", m === "register");
  document.getElementById("authSubmitBtn").textContent = m === "login" ? "Sign In" : "Create Account";
  document.getElementById("authHeading").textContent = m === "login" ? "Welcome Back" : "Join ChatHub";
  document.getElementById("authSub").textContent = m === "login" ? "Enter your credentials to continue" : "Create a permanent user identity";
}

async function submitAuth(){
  const u=document.getElementById("authUser").value.trim().toLowerCase();
  const p=document.getElementById("authPass").value;
  if(!u||!p) return showToast("Username and password required", "⚠️");

  try {
    const res=await fetch(`/api/${authMode}`,{method:"POST",body:new URLSearchParams({username:u,password:p})});
    const data=await res.json();
    if(!res.ok) return showToast(data.detail || "Authentication error", "❌");

    if(authMode === "register"){
      showToast("Account created! Please sign in.", "✓");
      document.getElementById("authPass").value = "";
      setAuthTab("login");
    } else {
      isGuestUser = false;
      myUser=data.username; authToken=data.token;
      const e2ee = window.E2EE || (typeof E2EE !== "undefined" ? E2EE : null);
      if (e2ee) e2ee.initUserIdentityKeys(myUser, authToken);
      
      myDisplayName = "";
      refreshSidebarIdentity();
      const navPub = document.getElementById("navPublic");
      if (navPub) navPub.style.display = "flex";
      const dm = document.getElementById("dmLabel");
      if (dm) dm.style.display = "block";
      const searchB = document.getElementById("searchBtn");
      if (searchB) searchB.style.display = "grid";
      const reqWrap = document.getElementById("requestsWrap");
      if (reqWrap) reqWrap.style.display = "block";
      
      renderAvatar(document.getElementById("sideAvatar"),myUser,"pres-green");
      closeOverlay("authOverlay");
      loadMyDisplayName();
      await Promise.all([fetchMyRooms(),fetchRequests()]);
      openRoom("public","Public Group",false);
    }
  } catch(e) {
    console.error("Auth submit error:", e);
    showToast(e.message || "Unable to connect to server", "❌");
  }
}

function logout(){ 
  if(ws) ws.close(); 
  myUser=""; 
  authToken=""; 
  window.history.replaceState(null, null, window.location.pathname);
  location.reload(); 
}

function applyGuestUIRestrictions(){
  document.getElementById("sideUser").textContent = myUser;
  document.getElementById("sideStatus").textContent = "temporary guest";
  renderAvatar(document.getElementById("sideAvatar"), myUser, "pres-green");
  
  const navPub = document.getElementById("navPublic");
  if (navPub) navPub.style.display = "none";
  const reqWrap = document.getElementById("requestsWrap");
  if (reqWrap) reqWrap.style.display = "none";
  const searchB = document.getElementById("searchBtn");
  if (searchB) searchB.style.display = "none";
  const dm = document.getElementById("dmLabel");
  if (dm) dm.style.display = "none";
  const rooms = document.getElementById("roomsList");
  if (rooms) rooms.innerHTML = "";
  const dms = document.getElementById("dmsList");
  if (dms) dms.innerHTML = "";
}


function setAccountTab(tab){
  const tabs = ["profile", "password", "appearance", "notify", "about"];
  tabs.forEach(t => {
    const cap = t.charAt(0).toUpperCase() + t.slice(1);
    const btn = document.getElementById(`acctTab${cap}`);
    const pane = document.getElementById(`acct${cap}Pane`);
    if(btn) btn.classList.toggle("active", tab === t);
    if(pane) pane.style.display = (tab === t) ? "block" : "none";
  });
  if(tab === "appearance" && typeof syncThemeSettingsUI === "function") {
    syncThemeSettingsUI();
  }
  if(tab === "password") {
    loadAccountSecurity();
  }
}

const AVATAR_COLOR_PALETTE = [
  "linear-gradient(135deg, #6366f1, #4f46e5)",
  "linear-gradient(135deg, #3b82f6, #1d4ed8)",
  "linear-gradient(135deg, #0ea5e9, #0284c7)",
  "linear-gradient(135deg, #10b981, #059669)",
  "linear-gradient(135deg, #8b5cf6, #7c3aed)",
  "linear-gradient(135deg, #ec4899, #db2777)",
  "linear-gradient(135deg, #f59e0b, #d97706)",
  "linear-gradient(135deg, #ef4444, #b91c1c)",
  "linear-gradient(135deg, #06b6d4, #8b5cf6)",
  "linear-gradient(135deg, #475569, #1e293b)",
  "#6366f1",
  "#10b981",
  "#ec4899",
  "#f59e0b"
];

function renderAvatarPalette(selectedColor){
  const grid = document.getElementById("avatarSwatchesGrid");
  if(!grid) return;
  const current = selectedColor || myAvatarColor || avColor(myUser || "?");
  grid.innerHTML = AVATAR_COLOR_PALETTE.map(c => {
    const isActive = (c === current);
    return `<button type="button" class="avatar-swatch ${isActive ? 'active' : ''}" style="background:${c}" onclick="selectAvatarColor('${esc(c)}')" title="${c}"></button>`;
  }).join("");
}

function selectAvatarColor(color){
  const hiddenInput = document.getElementById("acctAvatarColor");
  if(hiddenInput) hiddenInput.value = color;
  renderAvatarPalette(color);
  renderAvatar(document.getElementById("myAcctAvatarPreview"), myUser, myHidePresence ? "pres-grey" : "pres-green", color);
  renderAvatar(document.getElementById("myAcctAvatar"), myUser, myHidePresence ? "pres-grey" : "pres-green", color);
}

function applyStatusPreset(emoji, text){
  const emEl = document.getElementById("acctStatusEmoji");
  const txtEl = document.getElementById("acctCustomStatus");
  if(emEl) emEl.value = emoji;
  if(txtEl) txtEl.value = text;
  updateStatusPreview();
}

function clearStatusPreset(){
  const emEl = document.getElementById("acctStatusEmoji");
  const txtEl = document.getElementById("acctCustomStatus");
  if(emEl) emEl.value = "";
  if(txtEl) txtEl.value = "";
  updateStatusPreview();
}

function updateStatusPreview(){
  const em = (document.getElementById("acctStatusEmoji")?.value || "").trim();
  const txt = (document.getElementById("acctCustomStatus")?.value || "").trim();
  const wrap = document.getElementById("acctStatusPreviewWrap");
  const chip = document.getElementById("acctStatusPreviewChip");
  if(!wrap || !chip) return;
  if(!em && !txt){
    wrap.style.display = "none";
    chip.textContent = "";
  } else {
    chip.textContent = `${em ? em + " " : ""}${txt}`;
    wrap.style.display = "block";
  }
}

async function openMyAccount(){
  if(isGuestUser) return showToast("Guest sessions don't have an account", "⚠️");
  document.getElementById("myAcctUsername").textContent = myUser;
  renderAvatar(document.getElementById("myAcctAvatar"), myUser, myHidePresence ? "pres-grey" : "pres-green", myAvatarColor);
  renderAvatar(document.getElementById("myAcctAvatarPreview"), myUser, myHidePresence ? "pres-grey" : "pres-green", myAvatarColor);
  setAccountTab("profile");
  document.getElementById("acctCurrentPass").value = "";
  document.getElementById("acctNewPass").value = "";
  document.getElementById("acctConfirmPass").value = "";
  const pwWrap = document.getElementById("pwStrengthWrap");
  if(pwWrap) pwWrap.style.display = "none";
  const matchLbl = document.getElementById("pwMatchLabel");
  if(matchLbl) matchLbl.style.display = "none";

  renderAvatarPalette(myAvatarColor);

  try {
    const res = await fetch(`/api/account/profile?token=${encodeURIComponent(authToken)}`);
    const data = await res.json();
    if(res.ok){
      document.getElementById("acctDisplayName").value = data.display_name || "";
      document.getElementById("acctBio").value = data.bio || "";
      document.getElementById("acctShowDisplayName").checked = !!data.show_display_name;
      document.getElementById("acctShowBio").checked = !!data.show_bio;
      document.getElementById("acctCustomStatus").value = data.custom_status || "";
      document.getElementById("acctStatusEmoji").value = data.status_emoji || "";
      document.getElementById("acctAvatarColor").value = data.avatar_color || "";
      document.getElementById("acctHidePresence").checked = !!data.hide_presence;
      myAvatarColor = data.avatar_color || "";
      myHidePresence = !!data.hide_presence;
      renderAvatarPalette(myAvatarColor);
      renderAvatar(document.getElementById("myAcctAvatarPreview"), myUser, myHidePresence ? "pres-grey" : "pres-green", myAvatarColor);
      renderAvatar(document.getElementById("myAcctAvatar"), myUser, myHidePresence ? "pres-grey" : "pres-green", myAvatarColor);
      updateStatusPreview();
    }
  } catch(e) {}

  // Fetch account stats
  try {
    const sRes = await fetch(`/api/account/stats?token=${encodeURIComponent(authToken)}`);
    if(sRes.ok){
      const sData = await sRes.json();
      const sinceEl = document.getElementById("acctStatMemberSince");
      if(sinceEl){
        sinceEl.textContent = sData.member_since
          ? new Date(sData.member_since * 1000).toLocaleDateString([], {month:'short', year:'numeric'})
          : "Recently";
      }
      const msgsEl = document.getElementById("acctStatMessages");
      if(msgsEl) msgsEl.textContent = `${sData.messages_sent} sent`;
      const roomsEl = document.getElementById("acctStatRooms");
      if(roomsEl) roomsEl.textContent = `${sData.rooms_joined} active`;
      const cryptoEl = document.getElementById("acctStatCrypto");
      if(cryptoEl) cryptoEl.textContent = sData.e2ee_verified ? "Verified (P-256)" : "ECDH P-256";
    }
  } catch(e) {}

  openOverlay("myAccountOverlay");
}

async function saveAccountProfile(){
  const display_name = document.getElementById("acctDisplayName").value.trim();
  const bio = document.getElementById("acctBio").value.trim();
  const show_display_name = document.getElementById("acctShowDisplayName").checked;
  const show_bio = document.getElementById("acctShowBio").checked;
  const custom_status = document.getElementById("acctCustomStatus").value.trim();
  const status_emoji = document.getElementById("acctStatusEmoji").value.trim();
  const avatar_color = document.getElementById("acctAvatarColor").value.trim();
  const hide_presence = document.getElementById("acctHidePresence").checked;

  try {
    const res = await fetch("/api/account/update_profile", {
      method: "POST",
      body: new URLSearchParams({
        token: authToken,
        display_name,
        bio,
        show_display_name: show_display_name ? "on" : "",
        show_bio: show_bio ? "on" : "",
        custom_status,
        status_emoji,
        avatar_color,
        hide_presence: hide_presence ? "on" : ""
      })
    });
    const data = await res.json();
    if(!res.ok) return showToast(apiError(data, "Couldn't save profile"), "❌");
    myDisplayName = data.display_name || "";
    myCustomStatus = data.custom_status || "";
    myStatusEmoji = data.status_emoji || "";
    myAvatarColor = data.avatar_color || "";
    myHidePresence = !!data.hide_presence;
    if(myAvatarColor) {
      window.userAvatarColors[myUser.toLowerCase()] = myAvatarColor;
    }
    refreshSidebarIdentity();
    showToast("Profile saved", "✓");
  } catch(e) {
    showToast("Network error saving profile", "❌");
  }
}

async function toggleInvisibleMode(checked){
  myHidePresence = checked;
  try {
    await fetch("/api/account/update_profile", {
      method: "POST",
      body: new URLSearchParams({
        token: authToken,
        hide_presence: checked ? "on" : ""
      })
    });
    refreshSidebarIdentity();
    showToast(checked ? "Invisible mode enabled" : "Online presence restored", "👻");
  } catch(e) {}
}

async function exportMyAccountData(){
  const btn = document.getElementById("btnExportData");
  if(btn) btn.disabled = true;
  showToast("Compiling account archive...", "⏳");
  try {
    const res = await fetch(`/api/account/export?token=${encodeURIComponent(authToken)}`);
    if(!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chathub-account-${myUser}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast("Account data exported successfully", "📥");
  } catch(e) {
    showToast("Failed to download account archive", "❌");
  } finally {
    if(btn) btn.disabled = false;
  }
}

function promptDeleteAccount(){
  const passInp = document.getElementById("deleteAccountPass");
  if(passInp) passInp.value = "";
  openOverlay("deleteAccountOverlay");
  setTimeout(() => passInp?.focus(), 150);
}

async function executeDeleteAccount(){
  const passInp = document.getElementById("deleteAccountPass");
  const password = passInp ? passInp.value : "";
  if(!password) return showToast("Enter your password to confirm", "⚠️");

  try {
    const res = await fetch("/api/account/delete_account", {
      method: "POST",
      body: new URLSearchParams({
        token: authToken,
        password: password
      })
    });
    const data = await res.json();
    if(!res.ok) return showToast(apiError(data, "Account deletion failed"), "❌");

    closeOverlay("deleteAccountOverlay");
    closeOverlay("myAccountOverlay");
    showToast("Account permanently wiped. Goodbye!", "👋");
    authToken = "";
    myUser = "";
    setTimeout(() => {
      window.location.reload();
    }, 1200);
  } catch(e) {
    showToast("Network error deleting account", "❌");
  }
}

async function saveAccountPassword(){
  const current_password = document.getElementById("acctCurrentPass").value;
  const new_password = document.getElementById("acctNewPass").value;
  const confirm_password = document.getElementById("acctConfirmPass").value;

  if(!current_password || !new_password) return showToast("Fill in both password fields", "⚠️");
  if(new_password !== confirm_password) return showToast("New passwords don't match", "⚠️");
  if(new_password.length < 6) return showToast("New password must be 6+ characters", "⚠️");

  try {
    const res = await fetch("/api/account/change_password", {
      method: "POST",
      body: new URLSearchParams({ token: authToken, current_password, new_password })
    });
    const data = await res.json();
    if(!res.ok) return showToast(apiError(data, "Couldn't change password"), "❌");
    showToast("Password updated successfully", "✓");
    document.getElementById("acctCurrentPass").value = "";
    document.getElementById("acctNewPass").value = "";
    document.getElementById("acctConfirmPass").value = "";
    const pwWrap = document.getElementById("pwStrengthWrap");
    if(pwWrap) pwWrap.style.display = "none";
    const matchLbl = document.getElementById("pwMatchLabel");
    if(matchLbl) matchLbl.style.display = "none";
  } catch(e) {
    showToast("Network error changing password", "❌");
  }
}

// --- Security & Cryptography Center Logic ---

async function loadAccountSecurity(){
  if(!authToken || isGuestUser) return;
  
  // 1. Load E2EE Fingerprint
  const fpEl = document.getElementById("myFingerprintText");
  const e2ee = window.E2EE || (typeof E2EE !== "undefined" ? E2EE : null);
  if(e2ee && e2ee.getPublicKeyFingerprint){
    try {
      const fp = await e2ee.getPublicKeyFingerprint();
      if(fpEl) fpEl.textContent = fp;
    } catch(e) {
      if(fpEl) fpEl.textContent = "Unable to compute fingerprint";
    }
  }

  // 2. Load Active Sessions
  try {
    const res = await fetch(`/api/account/sessions?token=${encodeURIComponent(authToken)}`);
    if(res.ok){
      const data = await res.json();
      const sessions = data.sessions || [];
      const countEl = document.getElementById("secSessionCount");
      if(countEl) countEl.textContent = `${sessions.length} Active`;
      
      const listEl = document.getElementById("activeSessionsList");
      if(listEl){
        listEl.innerHTML = sessions.map(s => {
          const dateStr = s.created_at ? new Date(s.created_at * 1000).toLocaleString() : "Unknown time";
          return `
            <div class="session-row ${s.is_current ? 'current' : ''}">
              <div class="session-info">
                <div class="session-device">${s.is_current ? '🟢 Current Web Client (This Browser)' : '💻 Web Client Session'}</div>
                <div class="session-meta">Token: <code>${esc(s.session_id)}</code> • Logged in: ${dateStr}</div>
              </div>
              ${s.is_current ? '<span class="session-current-chip">ACTIVE NOW</span>' : ''}
            </div>
          `;
        }).join("");
      }

      const btnRevoke = document.getElementById("btnRevokeSessions");
      if(btnRevoke){
        btnRevoke.style.display = (sessions.length > 1) ? "block" : "none";
      }
    }
  } catch(e) {}
}

function copyMyFingerprint(){
  const fpEl = document.getElementById("myFingerprintText");
  if(!fpEl) return;
  const text = fpEl.textContent.trim();
  navigator.clipboard.writeText(text);
  showToast("Cryptographic Safety Number copied to clipboard!", "📋");
}

function viewPublicJwk(){
  const e2ee = window.E2EE || (typeof E2EE !== "undefined" ? E2EE : null);
  const jwkBox = document.getElementById("jwkViewerBox");
  const codeArea = document.getElementById("jwkCodeArea");
  if(!e2ee || !jwkBox || !codeArea) return;
  
  const jwk = e2ee.getPublicKeyJwk();
  if(!jwk){
    showToast("No active ECDH identity keypair found.", "⚠️");
    return;
  }
  codeArea.textContent = jwk;
  jwkBox.style.display = (jwkBox.style.display === "none" || !jwkBox.style.display) ? "block" : "none";
}

function promptRotateKeys(){
  showConfirmCard({
    icon: "🔄",
    title: "Rotate E2EE Identity Keys?",
    text: "This generates a brand-new P-256 ECDH keypair and registers your new public key on the server. Your past encrypted messages in this browser will remain readable.",
    onConfirm: executeRotateKeys
  });
}

async function executeRotateKeys(){
  const e2ee = window.E2EE || (typeof E2EE !== "undefined" ? E2EE : null);
  if(!e2ee || !e2ee.rotateIdentityKeys) return showToast("E2EE module unavailable", "❌");
  try {
    const newFp = await e2ee.rotateIdentityKeys(myUser, authToken);
    const fpEl = document.getElementById("myFingerprintText");
    if(fpEl) fpEl.textContent = newFp;
    const jwkBox = document.getElementById("jwkViewerBox");
    if(jwkBox && jwkBox.style.display !== "none") {
      document.getElementById("jwkCodeArea").textContent = e2ee.getPublicKeyJwk();
    }
    showToast("New cryptographic keypair generated & published!", "🔑");
  } catch(e) {
    showToast("Failed to rotate keys: " + (e.message || e), "❌");
  }
}

async function revokeOtherSessions(){
  try {
    const res = await fetch("/api/account/revoke_sessions", {
      method: "POST",
      body: new URLSearchParams({ token: authToken })
    });
    const d = await res.json();
    if(res.ok){
      showToast(d.detail || "Other sessions invalidated.", "🛡️");
      await loadAccountSecurity();
    } else {
      showToast(apiError(d, "Could not revoke sessions"), "❌");
    }
  } catch(e) {
    showToast("Network error revoking sessions", "❌");
  }
}

// Password Strength Evaluator
function onNewPasswordInput(val){
  const wrap = document.getElementById("pwStrengthWrap");
  const fill = document.getElementById("pwStrengthFill");
  const label = document.getElementById("pwStrengthLabel");
  if(!wrap || !fill || !label) return;

  if(!val){
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "flex";

  let score = 0;
  if(val.length >= 6) score += 1;
  if(val.length >= 10) score += 1;
  if(/[a-z]/.test(val) && /[A-Z]/.test(val)) score += 1;
  if(/[0-9]/.test(val)) score += 1;
  if(/[^A-Za-z0-9]/.test(val)) score += 1;

  if(score <= 1){
    fill.style.width = "20%";
    fill.style.background = "var(--danger)";
    label.textContent = "Too Short / Weak";
    label.style.color = "var(--danger)";
  } else if(score === 2){
    fill.style.width = "45%";
    fill.style.background = "#f59e0b";
    label.textContent = "Fair";
    label.style.color = "#f59e0b";
  } else if(score === 3 || score === 4){
    fill.style.width = "75%";
    fill.style.background = "#3b82f6";
    label.textContent = "Good";
    label.style.color = "#3b82f6";
  } else {
    fill.style.width = "100%";
    fill.style.background = "var(--online)";
    label.textContent = "Strong";
    label.style.color = "var(--online)";
  }

  const confirmVal = document.getElementById("acctConfirmPass").value;
  if(confirmVal) onConfirmPasswordInput(confirmVal);
}

function onConfirmPasswordInput(val){
  const newPass = document.getElementById("acctNewPass").value;
  const matchLabel = document.getElementById("pwMatchLabel");
  if(!matchLabel) return;

  if(!val){
    matchLabel.style.display = "none";
    return;
  }
  matchLabel.style.display = "block";
  if(val === newPass){
    matchLabel.textContent = "✓ Passwords match";
    matchLabel.className = "pw-match-label match";
  } else {
    matchLabel.textContent = "✕ Passwords do not match";
    matchLabel.className = "pw-match-label mismatch";
  }
}


// Sidebar identity: your display name (if you set one) is shown to YOU regardless
// of the visibility checkbox; that checkbox only controls what OTHER users see.
function refreshSidebarIdentity(){
  if(isGuestUser) return;
  const nameEl = document.getElementById("sideUser");
  const subEl = document.getElementById("sideStatus");
  const sideAv = document.getElementById("sideAvatar");

  if(sideAv) {
    const presClass = myHidePresence ? "pres-grey" : "pres-green";
    renderAvatar(sideAv, myUser, presClass, myAvatarColor);
  }

  if(nameEl) {
    if(myDisplayName){
      nameEl.textContent = myDisplayName;
    } else {
      nameEl.textContent = myUser;
    }
  }

  if(subEl) {
    if(myCustomStatus){
      subEl.textContent = `${myStatusEmoji ? myStatusEmoji + " " : ""}${myCustomStatus}`;
    } else if(myDisplayName){
      subEl.textContent = "@" + myUser;
    } else {
      subEl.textContent = myHidePresence ? "● invisible" : "profile & settings";
    }
  }
}

async function loadMyDisplayName(){
  try {
    const res = await fetch(`/api/account/profile?token=${encodeURIComponent(authToken)}`);
    if(!res.ok) return;
    const data = await res.json();
    myDisplayName = data.display_name || "";
    myCustomStatus = data.custom_status || "";
    myStatusEmoji = data.status_emoji || "";
    myAvatarColor = data.avatar_color || "";
    myHidePresence = !!data.hide_presence;
    if(myAvatarColor) {
      window.userAvatarColors[myUser.toLowerCase()] = myAvatarColor;
    }
    refreshSidebarIdentity();
  } catch(e) {}
}
