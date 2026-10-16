let roomFilter = "all"; // 'all', 'unread', 'channels', 'dms'
let roomSort = "recent"; // 'recent', 'alpha', 'unread'
let sidebarSearchQuery = "";

function onSidebarSearchInput(val) {
  sidebarSearchQuery = (val || "").trim().toLowerCase();
  const clearBtn = document.getElementById("sidebarSearchClear");
  if (clearBtn) clearBtn.style.display = sidebarSearchQuery ? "inline-flex" : "none";
  renderRoomLists();
}

function clearSidebarSearch() {
  sidebarSearchQuery = "";
  const input = document.getElementById("sidebarSearchInput");
  if (input) input.value = "";
  const clearBtn = document.getElementById("sidebarSearchClear");
  if (clearBtn) clearBtn.style.display = "none";
  setRoomFilter("all");
}

function setRoomFilter(f) {
  roomFilter = f;
  ["all", "unread", "channels", "dms"].forEach(id => {
    const el = document.getElementById(`filterPill_${id}`);
    if (el) el.classList.toggle("active", id === f);
  });
  renderRoomLists();
}

function toggleSortDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("sortDropdownMenu");
  if (!menu) return;
  menu.style.display = (menu.style.display === "none" || !menu.style.display) ? "block" : "none";
}

document.addEventListener("click", () => {
  const menu = document.getElementById("sortDropdownMenu");
  if (menu) menu.style.display = "none";
});

function setRoomSort(s) {
  roomSort = s;
  ["recent", "alpha", "unread"].forEach(id => {
    const el = document.getElementById(`sortOpt_${id}`);
    if (el) el.classList.toggle("active", id === s);
  });
  const label = document.getElementById("sortOrderLabel");
  if (label) {
    if (s === "recent") label.textContent = "Activity ▾";
    else if (s === "alpha") label.textContent = "A-Z ▾";
    else if (s === "unread") label.textContent = "Unread ▾";
  }
  const menu = document.getElementById("sortDropdownMenu");
  if (menu) menu.style.display = "none";
  renderRoomLists();
}

function highlightMatch(text, query) {
  if (!query || !text) return esc(text);
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) return esc(text);
  const before = esc(text.substring(0, idx));
  const matched = esc(text.substring(idx, idx + query.length));
  const after = esc(text.substring(idx + query.length));
  return `${before}<mark class="sidebar-match">${matched}</mark>${after}`;
}

async function fetchMyRooms(){
  if(!authToken) return;
  const res=await fetch(`/api/user/rooms?token=${encodeURIComponent(authToken)}`);
  if(!res.ok) return;
  myRooms=await res.json();
  renderRoomLists();
}

function renderRoomLists(){
  const isChat = currentView === "chat";

  // Public channel item
  const navPublic = document.getElementById("navPublic");
  if (navPublic && !isGuestUser) {
    navPublic.classList.toggle("active", isChat && currentRoom==="public");
    const matchesPublic = !sidebarSearchQuery || "public group".includes(sidebarSearchQuery);
    const filterAllowsPublic = (roomFilter === "all" || roomFilter === "channels");
    navPublic.style.display = (matchesPublic && filterAllowsPublic) ? "flex" : "none";
  }
  
  // Ephemeral pinned slots
  const ephSlot = document.getElementById("ephRoomSlot");
  if (myPinnedEphemerals.length > 0) {
    ephSlot.innerHTML = myPinnedEphemerals
      .filter(r => {
        if (roomFilter === "dms") return false;
        if (!sidebarSearchQuery) return true;
        return (r.title && r.title.toLowerCase().includes(sidebarSearchQuery)) || r.id.toLowerCase().includes(sidebarSearchQuery);
      })
      .map(r => {
        const isActive = isChat && currentRoom === r.id;
        return `
          <div class="nav-row ${isActive ? 'active-eph' : ''}" onclick="openRoom('${esc(r.id)}','${esc(r.title)}',false)">
            <span class="prefix">⚡</span>
            <span class="label">${highlightMatch(r.title, sidebarSearchQuery)}</span>
            <button class="close-eph-btn" onclick="unpinEphemeralRoom('${esc(r.id)}', event)" title="Leave space">✕</button>
          </div>
        `;
      }).join("");
  } else {
    ephSlot.innerHTML = "";
  }

  if(isGuestUser) return;

  // Compute total unread rooms badge count
  let totalUnreadRooms = 0;
  myRooms.forEach(r => {
    if ((r.unread_count || 0) > 0) totalUnreadRooms++;
  });
  const unreadBadge = document.getElementById("unreadFilterBadge");
  if (unreadBadge) {
    unreadBadge.textContent = totalUnreadRooms;
    unreadBadge.style.display = totalUnreadRooms > 0 ? "inline-flex" : "none";
  }

  // Filter & sort
  let filtered = myRooms.slice();

  // Search filter
  if (sidebarSearchQuery) {
    filtered = filtered.filter(r => {
      const name = (r.name || "").toLowerCase();
      const id = (r.id || "").toLowerCase();
      return name.includes(sidebarSearchQuery) || id.includes(sidebarSearchQuery);
    });
  }

  // Category filter
  if (roomFilter === "unread") {
    filtered = filtered.filter(r => (r.unread_count || 0) > 0);
  } else if (roomFilter === "channels") {
    filtered = filtered.filter(r => !r.is_dm);
  } else if (roomFilter === "dms") {
    filtered = filtered.filter(r => r.is_dm);
  }

  // Smart sort
  filtered.sort((a, b) => {
    if (roomSort === "recent") {
      return (b.last_activity || 0) - (a.last_activity || 0);
    } else if (roomSort === "alpha") {
      return (a.name || "").localeCompare(b.name || "");
    } else if (roomSort === "unread") {
      const diff = (b.unread_count || 0) - (a.unread_count || 0);
      if (diff !== 0) return diff;
      return (b.last_activity || 0) - (a.last_activity || 0);
    }
    return 0;
  });

  const groups = filtered.filter(r => !r.is_dm);
  const dms = filtered.filter(r => r.is_dm);

  // Section visibility
  const secChannels = document.getElementById("sectionChannels");
  const secDms = document.getElementById("sectionDms");
  if (secChannels) {
    secChannels.style.display = (roomFilter === "dms" || (groups.length === 0 && ephSlot.children.length === 0 && (!navPublic || navPublic.style.display === "none"))) ? "none" : "block";
  }
  if (secDms) {
    secDms.style.display = (roomFilter === "channels" || dms.length === 0) ? "none" : "block";
  }

  // Empty filter state
  const emptyState = document.getElementById("sidebarEmptyFilter");
  if (emptyState) {
    const hasAnyVisible = (groups.length > 0 || dms.length > 0 || (navPublic && navPublic.style.display !== "none") || ephSlot.children.length > 0);
    emptyState.style.display = (!hasAnyVisible && (sidebarSearchQuery || roomFilter !== "all")) ? "block" : "none";
  }

  // Render roomsList
  document.getElementById("roomsList").innerHTML = groups.map(r => {
    const unreadPill = (r.unread_count && r.unread_count > 0)
      ? `<span class="room-unread-badge">${r.unread_count > 99 ? '99+' : r.unread_count}</span>`
      : "";
    return `
      <button class="nav-row ${isChat && currentRoom === r.id ? 'active' : ''}" onclick="openRoom('${esc(r.id)}','${esc(r.name)}',false)">
        <span class="prefix">#</span>
        <span class="label">${highlightMatch(r.name, sidebarSearchQuery)}</span>
        ${unreadPill}
      </button>
    `;
  }).join("");

  // Render dmsList
  document.getElementById("dmsList").innerHTML = dms.map(r => {
    const unreadPill = (r.unread_count && r.unread_count > 0)
      ? `<span class="room-unread-badge">${r.unread_count > 99 ? '99+' : r.unread_count}</span>`
      : "";
    return `
      <button class="nav-row ${isChat && currentRoom === r.id ? 'active' : ''}" onclick="openRoom('${esc(r.id)}','${esc(r.name)}',true)">
        <span class="prefix">@</span>
        <span class="label">${highlightMatch(r.name.replace(/^@/, ''), sidebarSearchQuery)}</span>
        ${unreadPill}
      </button>
    `;
  }).join("");

  const statRooms = document.getElementById("statRooms");
  if (statRooms) statRooms.textContent = myRooms.length;
}

function openRoom(id,name,isDm){ 
  if (isGuestUser && !id.startsWith("tmp_")) {
    showToast("Guest accounts cannot access persistent channels", "🚫");
    return;
  }
  
  // Clear unread count locally when room is opened
  const found = myRooms.find(r => r.id === id);
  if (found) {
    found.unread_count = 0;
  }

  setView("chat"); 
  connectRoom(id,name,isDm); 
}

function openRoomModal(tab){
  setRoomTab(tab);
  openOverlay("roomOverlay");
}

function setRoomTab(t){
  document.getElementById("roomTabCreate").classList.toggle("active", t === "create");
  document.getElementById("roomTabJoin").classList.toggle("active", t === "join");
  const tabEph = document.getElementById("roomTabEph");
  if (tabEph) tabEph.classList.toggle("active", t === "eph");

  document.getElementById("createFields").style.display = t === "create" ? "block" : "none";
  document.getElementById("joinFields").style.display = t === "join" ? "block" : "none";
  const ephFields = document.getElementById("ephModalFields");
  if (ephFields) ephFields.style.display = t === "eph" ? "block" : "none";
}

async function createDisposableRoomFromModal(){
  const roomType = document.getElementById("modalEphType").value;
  const limit = roomType === "dm" ? 2 : parseInt(document.getElementById("modalEphLimit").value || "5", 10);
  closeOverlay("roomOverlay");
  document.getElementById("ephType").value = roomType;
  document.getElementById("ephLimit").value = limit;
  await createDisposableRoom();
}

async function createRoom(){
  const name=document.getElementById("cRoomName").value.trim();
  const pass=document.getElementById("cRoomPass").value;
  if(!name) return showToast("Room title required", "⚠️");
  if(pass.length<4) return showToast("Passkey must be 4+ characters", "⚠️");
  const res=await fetch("/api/rooms/create",{method:"POST",body:new URLSearchParams({room_name:name,passkey:pass,token:authToken})});
  const d=await res.json();
  if(!res.ok) return showToast(apiError(d,"Error creating room"), "❌");
  closeOverlay("roomOverlay");
  document.getElementById("cRoomName").value = "";
  document.getElementById("cRoomPass").value = "";
  const e2ee = window.E2EE || (typeof E2EE !== "undefined" ? E2EE : null);
  if (e2ee) e2ee.deriveRoomKey(d.room_id, pass);
  await fetchMyRooms();
  openRoom(d.room_id,d.room_name,false);
  showToast(`Space created! Key: ${d.room_id}`, "🔑");
}

async function joinRoomSubmit(){
  const key=document.getElementById("jRoomKey").value.trim().toLowerCase();
  const pass=document.getElementById("jRoomPass").value;
  if(!key) return showToast("Room key required", "⚠️");
  const res=await fetch("/api/rooms/join",{method:"POST",body:new URLSearchParams({room_key:key,passkey:pass,token:authToken})});
  const d=await res.json();
  if(!res.ok) return showToast(apiError(d,"Invalid room key or passkey"), "❌");
  closeOverlay("roomOverlay");
  document.getElementById("jRoomKey").value = "";
  document.getElementById("jRoomPass").value = "";
  const e2ee = window.E2EE || (typeof E2EE !== "undefined" ? E2EE : null);
  if (e2ee) e2ee.deriveRoomKey(d.room_id, pass);
  await fetchMyRooms();
  openRoom(d.room_id,d.room_name,false);
}

function promptDestruct(){
  document.getElementById("btnShowDestruct").style.display = "none";
  document.getElementById("confirmDestructBox").style.display = "block";
}

function cancelDestruct(){
  document.getElementById("confirmDestructBox").style.display = "none";
  document.getElementById("btnShowDestruct").style.display = "block";
}

async function executeDestruct(){
  const res = await fetch("/api/rooms/destruct", {
    method: "POST",
    body: new URLSearchParams({ room_id: currentRoom, token: authToken })
  });
  if(res.ok){
    closeOverlay("infoOverlay");
    cancelDestruct();
    await fetchMyRooms();
    openRoom("public","Public Group",false);
    showToast("Space disbanded permanently.", "🗑️");
  } else {
    showToast("Failed to disband space.", "❌");
  }
}

async function submitPasskeyChange(){
  const oldPass = document.getElementById("oldPasskeyInput").value;
  const newPass = document.getElementById("newPasskeyInput").value;
  if(!oldPass) return showToast("Current passkey required", "⚠️");
  if(!newPass || newPass.length < 4) return showToast("New passkey must be 4+ characters", "⚠️");

  try {
    const res = await fetch("/api/rooms/update_passkey", {
      method: "POST",
      body: new URLSearchParams({
        room_id: currentRoom,
        current_passkey: oldPass,
        new_passkey: newPass,
        token: authToken
      })
    });
    const d = await res.json();
    if(res.ok){
      document.getElementById("oldPasskeyInput").value = "";
      document.getElementById("newPasskeyInput").value = "";
      showToast(d.detail || "Passkey updated!", "🔑");
    } else {
      showToast(apiError(d, "Could not update passkey"), "❌");
    }
  } catch(e) {
    showToast("Error updating passkey", "❌");
  }
}

async function fetchBans(){
  if(!amIRoomAdmin || currentRoom==="public" || currentRoom.startsWith("dm_") || currentRoom.startsWith("tmp_")) return;
  try {
    const res = await fetch(`/api/rooms/bans?room_id=${encodeURIComponent(currentRoom)}&token=${encodeURIComponent(authToken)}`);
    if(!res.ok) return;
    const d = await res.json();
    const list = document.getElementById("bannedList");
    if(!d.bans || !d.bans.length){
      list.innerHTML = `<div style="color:var(--muted-2);font-size:.76rem;padding:4px 0">No banned members.</div>`;
      return;
    }
    list.innerHTML = d.bans.map(b => `
      <div class="ban-row">
        <div style="font-size:.8rem">
          <b>@${esc(b.username)}</b>
          <span style="font-size:.68rem;color:var(--muted);margin-left:6px">${b.permanent ? 'Permanent' : 'Timed'}</span>
        </div>
        <button class="btn-mini" style="padding:4px 8px;font-size:.72rem" onclick="promptUnban('${esc(b.username)}')">Unban</button>
      </div>
    `).join("");
  } catch(e) {}
}

function promptUnban(target){
  showConfirmCard({
    icon: "🔓",
    title: `Unban @${target}?`,
    text: `They will be allowed to rejoin ${currentRoomTitle} using the passkey.`,
    onConfirm: ()=>executeUnban(target)
  });
}

async function executeUnban(target){
  try {
    const res = await fetch("/api/rooms/unban", {method:"POST", body:new URLSearchParams({
      room_id: currentRoom, target_user: target, token: authToken
    })});
    const d = await res.json();
    if(!res.ok) return showToast(apiError(d, "Couldn't unban member"), "❌");
    showToast(`@${target} can now rejoin.`, "✓");
    fetchBans();
  } catch(e) {
    showToast("Error unbanning member", "❌");
  }
}

let currentRosterData = null;

function filterRoster(q){
  if(!currentRosterData) return;
  const query = (q || "").trim().toLowerCase();
  const members = currentRosterData.members || [];
  const filtered = !query ? members : members.filter(m => {
    return (m.username && m.username.toLowerCase().includes(query)) ||
           (m.display_name && m.display_name.toLowerCase().includes(query));
  });
  renderRosterList(filtered, currentRosterData);
}

function renderRosterList(members, data){
  const rosterEl = document.getElementById("inspectRoster");
  if(!rosterEl) return;
  
  if(!members || members.length === 0){
    rosterEl.innerHTML = `<div style="font-size:0.75rem;color:var(--muted-2);padding:14px 4px;text-align:center">No matching members</div>`;
    return;
  }

  const isEphemeral = currentRoom.startsWith("tmp_");
  const isDm = currentRoomIsDm;
  const isPublic = currentRoom === "public";
  const canBan = amIRoomAdmin && !isEphemeral && !isDm && !isPublic;
  const activeAlias = getActiveRoomAlias();

  rosterEl.innerHTML = members.map(m => {
    const isOwner = (m.username === data.created_by);
    let presClass = "pres-grey";
    let statusText = "offline";

    if (!data.is_private) {
      presClass = (m.presence === "online" || m.presence === "here") ? "pres-green" : "pres-grey";
      statusText = (presClass === "pres-green") ? "online" : "offline";
    } else {
      if (m.presence === "here") {
        presClass = "pres-green";
        statusText = "active now";
      } else if (m.presence === "elsewhere") {
        presClass = "pres-orange";
        statusText = "online elsewhere";
      } else {
        presClass = "pres-grey";
        statusText = "offline";
      }
    }

    return `
      <div class="roster-item" onclick="${isEphemeral ? '' : `openProfile('${esc(m.username)}', '${m.presence}', ${data.is_private})`}">
        <div class="roster-user">
          <div class="av roster-avatar ${presClass}" style="background:${avColor(m.username)};color:#fff">
            ${esc(initials(m.username))}
          </div>
          <div class="roster-info">
            <div class="roster-name-row">
              <span class="roster-name">${esc(m.display_name || m.username)}</span>
              ${isOwner ? '<span class="roster-role-chip owner">OWNER</span>' : ''}
            </div>
            <span class="roster-status ${presClass}">● ${statusText}</span>
          </div>
        </div>
        ${(canBan && m.username !== activeAlias) ? `<button class="roster-ban-btn" onclick="event.stopPropagation(); openBan('${esc(m.username)}')">Ban</button>` : ''}
      </div>
    `;
  }).join("");
}

async function syncSpaceInspector(){
  if (currentView !== "chat") return;
  const isEphemeral = currentRoom.startsWith("tmp_");
  const isDm = currentRoomIsDm;
  const isPublic = currentRoom === "public";
  
  const copyBtn = document.getElementById("btnCopyKey");
  if(copyBtn) copyBtn.style.display = (isEphemeral || (!isDm && !isPublic)) ? "inline-flex" : "none";

  try {
    const res = await fetch(`/api/rooms/details?room_id=${encodeURIComponent(currentRoom)}&token=${encodeURIComponent(authToken)}`);
    if(!res.ok) return;
    const data = await res.json();
    currentRosterData = data;

    if (data.members) {
      roomMembersCache = data.members.map(m => m.username);
    }

    const nameEl = document.getElementById("inspectName");
    const avEl = document.getElementById("inspectAvatar");
    const subEl = document.getElementById("inspectSub");
    const countEl = document.getElementById("inspectCount");
    const typeEl = document.getElementById("inspectRoomType");
    const creatorEl = document.getElementById("inspectCreator");
    const privEl = document.getElementById("inspectPrivacy");

    if(nameEl) nameEl.textContent = data.room_name;
    if(avEl) {
      avEl.textContent = initials(data.room_name);
      avEl.style.background = isPublic ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : avColor(data.room_name);
    }
    if(subEl) {
      subEl.textContent = isEphemeral 
        ? `Ephemeral Space (Max ${data.max_users})` 
        : (isDm ? "Direct 1-on-1" : (isPublic ? "Public Channel" : "Private Space"));
    }
    if(typeEl) typeEl.textContent = isEphemeral ? "Disposable Ephemeral" : (isDm ? "Direct DM Stream" : (isPublic ? "Global Community" : "Encrypted Space"));
    if(creatorEl) creatorEl.textContent = `@${data.created_by || 'Admin'}`;
    if(privEl) privEl.textContent = data.is_private ? "Protected Key" : "Open Workspace";
    if(countEl) countEl.textContent = `${data.total_members}`;

    const encEl = document.getElementById("inspectEncryption");
    const retEl = document.getElementById("inspectRetention");
    if(encEl) {
      if(isDm) encEl.textContent = "🔒 E2EE (ECDH + AES-256-GCM)";
      else if(isEphemeral) encEl.textContent = "⚡ Zero-Retention RAM Stream";
      else if(isPublic) encEl.textContent = "🌐 TLS 1.3 Transport In-Transit";
      else encEl.textContent = "🔑 Passkey (PBKDF2 + AES-GCM)";
    }
    if(retEl) {
      if(isEphemeral) retEl.textContent = "Zero Retention (RAM Only)";
      else if(isPublic) retEl.textContent = "48-Hour Message Auto-Purge";
      else retEl.textContent = "Persistent (Creator Disbandable)";
    }

    renderRosterList(data.members || [], data);
  } catch(e) {}
}

function getActiveRoomAlias(){
  if (currentRoom.startsWith("tmp_")) {
    const pinned = myPinnedEphemerals.find(r => r.id === currentRoom);
    return pinned ? pinned.alias : myUser;
  }
  return myUser;
}

function copySpaceKey(){
  navigator.clipboard.writeText(currentRoom);
  showToast(`Space key copied: ${currentRoom}`, "📋");
}

function openRoomInfo(){
  cancelDestruct();
  const adminControls = document.getElementById("adminRoomControls");
  const activeAlias = getActiveRoomAlias();

  if(currentRoom.startsWith("tmp_")){
    document.getElementById("infoTitle").textContent = "⚡ Disposable Session";
    document.getElementById("infoDesc").textContent = "Auto-Destruct Active";
    document.getElementById("infoBody").innerHTML = `
      <div style="background:var(--surface-2);padding:10px;border-radius:9px;border:1px solid var(--border)">
        <div><b>Room Code:</b> <code style="color:#fcd34d;user-select:all;font-size:.85rem">${currentRoom}</code></div>
        <div style="margin-top:6px"><b>Your Temporary Alias:</b> <code style="color:var(--text);font-weight:600">${esc(activeAlias)}</code></div>
        <div style="color:#fca5a5;font-size:.72rem;margin-top:6px;line-height:1.4">
          ⚠️ This session is non-persistent. When all participants disconnect, all messages and attachments are wiped permanently.
        </div>
      </div>`;
    adminControls.style.display = "none";
  } else if(currentRoomIsDm){
    document.getElementById("infoTitle").textContent = currentRoomTitle;
    document.getElementById("infoDesc").textContent = "Direct 1-on-1 Session";
    document.getElementById("infoBody").innerHTML = `
      <div style="background:var(--surface-2);padding:10px;border-radius:8px;border:1px solid var(--border)">
        <div><b>Session:</b> Private Conversation</div>
        <div style="color:var(--muted);font-size:.72rem;margin-top:4px">Only invited participants can view this stream.</div>
      </div>`;
    adminControls.style.display = "none";
  } else if(currentRoom === "public"){
    document.getElementById("infoTitle").textContent = "Public Group";
    document.getElementById("infoDesc").textContent = "Global Channel";
    document.getElementById("infoBody").innerHTML = `
      <div style="background:var(--surface-2);padding:10px;border-radius:8px;border:1px solid var(--border)">
        <div><b>Retention:</b> 48-Hour Message Auto-Purge</div>
        <div style="color:var(--muted);font-size:.72rem;margin-top:4px">Messages auto-clean from the database after 48 hours.</div>
      </div>`;
    adminControls.style.display = "none";
  } else {
    document.getElementById("infoTitle").textContent = currentRoomTitle;
    document.getElementById("infoDesc").textContent = `Passkey-protected space`;
    document.getElementById("infoBody").innerHTML = `
      <div style="background:var(--surface-2);padding:10px;border-radius:8px;border:1px solid var(--border)">
        <div><b>Owner:</b> @${esc(currentCreator) || 'Admin'}</div>
        <div style="margin-top:6px"><b>Share Key:</b> <code style="color:var(--text);user-select:all">${currentRoom}</code></div>
        <div style="color:var(--muted);font-size:.74rem;margin-top:4px">New users require the space key and passkey to join.</div>
      </div>`;
    adminControls.style.display = (currentCreator === myUser) ? "block" : "none";
    if(currentCreator === myUser) fetchBans();
  }
  openOverlay("infoOverlay");
}

function openBan(target){
  window.banTarget = target;
  document.getElementById("banTargetLabel").textContent = `Target: @${target}`;
  openOverlay("banOverlay");
}

async function submitBan(){
  const banType = document.getElementById("banType").value;
  const duration = document.getElementById("banDur").value;
  try {
    const res = await fetch("/api/rooms/ban", {method:"POST", body:new URLSearchParams({
      room_id: currentRoom,
      token: authToken,
      target_user: window.banTarget,
      ban_type: banType,
      duration: duration
    })});
    const d = await res.json();
    if(!res.ok) return showToast(apiError(d, "Couldn't ban member"), "❌");
    closeOverlay("banOverlay");
    showToast(`@${window.banTarget} was banned.`, "🚫");
    syncSpaceInspector();
  } catch(e) {
    showToast("Network error executing ban", "❌");
  }
}

