// CLEAN ADDRESS BAR ON PAGE LOAD: Clear any leftover hash fragments from past sessions
if (window.location.hash) {
  window.history.replaceState(null, null, window.location.pathname);
}

// In-memory session state (pure, matching original backup)
let ws=null, myUser="", authToken="", currentView="chat", myDisplayName="";
let myCustomStatus="", myStatusEmoji="", myAvatarColor="", myHidePresence=false;
let currentRoom="public", currentRoomTitle="Public Group", currentRoomIsDm=false, currentCreator="";
let myRooms=[], pendingRequests=[], directoryCache=[];
let typingTimer=null, lastTypingSent=0, tickerTimer=null, searchDebounce=null;
let authMode="login", isGuestUser=false, amIRoomAdmin=false;

let myPinnedEphemerals = [];
let rightPanelOpen = false;
let activeReply = null;

let roomMembersCache = [];
let mentionSelectedIndex = 0;
let mentionMatchStart = -1;

let activityFeed = [];
let activeNotifyFilter = "all";

let unreadCount = 0;
const ORIGINAL_TITLE = "ChatHub";

let myClientId = "c_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 10);

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
window.audioCtx = audioCtx;

if ("Notification" in window && Notification.permission === "default") {
  window.addEventListener("click", () => {
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, { once: true });
}

window.addEventListener("focus", () => {
  unreadCount = 0;
  document.title = ORIGINAL_TITLE;
});

const AV_COLORS = [
  "linear-gradient(135deg, #6366f1, #4f46e5)",
  "linear-gradient(135deg, #3b82f6, #1d4ed8)",
  "linear-gradient(135deg, #0ea5e9, #0284c7)",
  "linear-gradient(135deg, #10b981, #059669)",
  "linear-gradient(135deg, #8b5cf6, #7c3aed)",
  "linear-gradient(135deg, #ec4899, #db2777)",
  "linear-gradient(135deg, #f59e0b, #d97706)"
];




const leftPanel=document.getElementById("leftPanel"), rightPanel=document.getElementById("rightPanel"), backdrop=document.getElementById("backdrop");
const toggleRightBtn = document.getElementById("toggleRightBtn");

































// CLEAN ROOM SWITCHING: Never updates URL hash, keeping address bar clean

































const THEME_PRESETS = [
  { id: "dark", name: "Dark Slate", desc: "Default balanced obsidian dark", railBg: "#07080c", bg: "#0d0e15", surface: "#141724", accent: "#6366f1" },
  { id: "midnight", name: "Midnight OLED", desc: "Pure pitch black for OLED panels", railBg: "#000000", bg: "#040507", surface: "#0c0d12", accent: "#6366f1" },
  { id: "cyberpunk", name: "Cyberpunk", desc: "Vibrant synthwave & neon purple", railBg: "#090514", bg: "#0f0a20", surface: "#1d1238", accent: "#a855f7" },
  { id: "oceanic", name: "Oceanic", desc: "Deep marine & arctic frost cyan", railBg: "#03080d", bg: "#07121b", surface: "#122434", accent: "#06b6d4" },
  { id: "emerald", name: "Forest Emerald", desc: "Deep botanical matrix green", railBg: "#030a06", bg: "#06150e", surface: "#11281c", accent: "#10b981" },
  { id: "crimson", name: "Crimson Ember", desc: "Warm sunset rose & dark mocha", railBg: "#0a0407", bg: "#14090e", surface: "#26131c", accent: "#f43f5e" },
  { id: "light", name: "Studio Light", desc: "Clean modern pearl light", railBg: "#e2e8f0", bg: "#f8fafc", surface: "#ffffff", accent: "#4f46e5" },
  { id: "sepia", name: "Warm Sepia", desc: "Soft parchment paper for reading", railBg: "#eae2d3", bg: "#f8f4ec", surface: "#ffffff", accent: "#d97706" }
];

const ACCENT_PRESETS = [
  { id: "indigo", name: "Indigo", color: "#6366f1" },
  { id: "violet", name: "Violet", color: "#a855f7" },
  { id: "cyan", name: "Cyan", color: "#06b6d4" },
  { id: "emerald", name: "Emerald", color: "#10b981" },
  { id: "amber", name: "Amber", color: "#f59e0b" },
  { id: "rose", name: "Rose", color: "#f43f5e" }
];

function applyTheme(themeId){
  document.documentElement.setAttribute("data-theme", themeId);
  try { localStorage.setItem("chathub_theme", themeId); } catch(e) {}
  syncThemeSettingsUI();
}

function applyAccent(accentId){
  document.documentElement.setAttribute("data-accent", accentId);
  try { localStorage.setItem("chathub_accent", accentId); } catch(e) {}
  syncThemeSettingsUI();
}

function applyDensity(density){
  document.documentElement.setAttribute("data-density", density);
  try { localStorage.setItem("chathub_density", density); } catch(e) {}
  syncThemeSettingsUI();
}

function toggleTheme(){
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const isLight = (current === "light" || current === "sepia");
  const next = isLight ? "dark" : "light";
  applyTheme(next);
  if(typeof showToast === "function") {
    showToast(`Switched to ${next === "light" ? "Studio Light" : "Dark Slate"}`, "🎨");
  }
}

function syncThemeSettingsUI(){
  const curTheme = document.documentElement.getAttribute("data-theme") || "dark";
  const curAccent = document.documentElement.getAttribute("data-accent") || "indigo";
  const curDensity = document.documentElement.getAttribute("data-density") || "cozy";

  // Sync theme gallery cards
  document.querySelectorAll(".theme-card").forEach(card => {
    const tid = card.getAttribute("data-theme-id");
    card.classList.toggle("active", tid === curTheme);
  });

  // Sync accent buttons
  document.querySelectorAll(".accent-circle-btn").forEach(btn => {
    const aid = btn.getAttribute("data-accent-id");
    btn.classList.toggle("active", aid === curAccent);
  });

  // Sync density buttons
  const cozyBtn = document.getElementById("densityBtn_cozy");
  const compactBtn = document.getElementById("densityBtn_compact");
  if(cozyBtn) cozyBtn.classList.toggle("active", curDensity === "cozy");
  if(compactBtn) compactBtn.classList.toggle("active", curDensity === "compact");
}

function initThemeSystem(){
  const grid = document.getElementById("themeGalleryGrid");
  const accentRow = document.getElementById("accentPaletteRow");
  
  if(grid && grid.children.length === 0){
    grid.innerHTML = THEME_PRESETS.map(t => `
      <div class="theme-card" data-theme-id="${t.id}" onclick="applyTheme('${t.id}')">
        <div class="theme-preview-box" style="background:${t.bg}">
          <div class="theme-preview-rail" style="background:${t.railBg}"></div>
          <div class="theme-preview-sidebar" style="background:${t.surface};border-right:1px solid rgba(255,255,255,0.06)"></div>
          <div class="theme-preview-chat">
            <div class="theme-preview-line" style="background:${t.accent}"></div>
            <div class="theme-preview-line accent" style="background:rgba(255,255,255,0.2)"></div>
          </div>
        </div>
        <div class="theme-card-info">
          <div class="theme-card-name">
            <span>${t.name}</span>
            <span class="theme-card-check">✓</span>
          </div>
          <div class="theme-card-desc">${t.desc}</div>
        </div>
      </div>
    `).join("");
  }

  if(accentRow && accentRow.children.length === 0){
    accentRow.innerHTML = ACCENT_PRESETS.map(a => `
      <button class="accent-circle-btn" data-accent-id="${a.id}" onclick="applyAccent('${a.id}')" title="${a.name} accent" style="background:${a.color}"></button>
    `).join("");
  }

  syncThemeSettingsUI();
}

window.addEventListener("DOMContentLoaded", initThemeSystem);
// In case DOM is already loaded
if(document.readyState === "complete" || document.readyState === "interactive"){
  setTimeout(initThemeSystem, 10);
}
