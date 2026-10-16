let dirFilter = "all"; // 'all' or 'online'
let dirSort = "online"; // 'online' or 'alpha'
let dirSearchQuery = "";

function setDirFilter(f){
  dirFilter = f;
  const tabAll = document.getElementById("dirTabAll");
  const tabOnline = document.getElementById("dirTabOnline");
  if(tabAll) tabAll.classList.toggle("active", f === "all");
  if(tabOnline) tabOnline.classList.toggle("active", f === "online");
  renderDirectoryView();
}

function setDirSort(s){
  dirSort = s;
  renderDirectoryView();
}

function filterDirectory(q){
  dirSearchQuery = (q || "").trim().toLowerCase();
  renderDirectoryView();
}

function renderDirectoryView(){
  if(!directoryCache) return;
  let users = directoryCache.slice();

  // Search filter
  if(dirSearchQuery){
    users = users.filter(u => {
      const uname = (u.username || "").toLowerCase();
      const dname = (u.display_name || "").toLowerCase();
      return uname.includes(dirSearchQuery) || dname.includes(dirSearchQuery);
    });
  }

  // Online filter
  if(dirFilter === "online"){
    users = users.filter(u => u.online);
  }

  // Sort
  users.sort((a, b) => {
    if(dirSort === "online"){
      if(b.online !== a.online) return (b.online ? 1 : 0) - (a.online ? 1 : 0);
      return (a.username || "").localeCompare(b.username || "");
    } else if(dirSort === "alpha"){
      const nameA = (a.display_name || a.username || "").toLowerCase();
      const nameB = (b.display_name || b.username || "").toLowerCase();
      return nameA.localeCompare(nameB);
    }
    return 0;
  });

  const grid = document.getElementById("peersGrid");
  if(!grid) return;
  if(users.length === 0){
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:36px;color:var(--muted);font-size:.85rem">No peers matching your filter or search.</div>`;
    return;
  }

  grid.innerHTML = users.map(u => {
    if(u.avatar_color) window.userAvatarColors[u.username.toLowerCase()] = u.avatar_color;
    const bg = u.avatar_color || (window.userAvatarColors && window.userAvatarColors[u.username.toLowerCase()]) || avColor(u.username);
    const statusTxt = u.custom_status ? `${u.status_emoji ? esc(u.status_emoji) + ' ' : ''}${esc(u.custom_status)}` : (u.online ? '● Online' : 'Offline');
    return `
    <div class="peer-card">
      <div style="display:flex;align-items:center;gap:10px;min-width:0">
        <div class="av ${u.online ? 'pres-green' : 'pres-grey'}" style="width:34px;height:34px;font-size:.82rem;background:${bg};color:#fff;flex-shrink:0">${esc(initials(u.username))}</div>
        <div style="min-width:0;flex:1">
          <div style="font-size:.84rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.display_name ? `${esc(u.display_name)} <span style="color:var(--muted-2);font-weight:400;font-size:.78rem">@${esc(u.username)}</span>` : `@${esc(u.username)}`}</div>
          <div style="font-size:.66rem;font-family:var(--mono);color:${u.online?'var(--online)':'var(--offline)'};margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${statusTxt}</div>
        </div>
      </div>
      <button class="btn-mini" onclick="openProfile('${esc(u.username)}','${u.online ? 'here' : 'offline'}',false)">Chat</button>
    </div>
  `;
  }).join("");
}

async function refreshDirectory(){
  if(!authToken) return;
  const res=await fetch(`/api/users/directory?token=${encodeURIComponent(authToken)}`);
  if(!res.ok) return;
  const data=await res.json();
  directoryCache=data.users;
  if(Array.isArray(data.users)){
    data.users.forEach(u => {
      if(u.avatar_color) window.userAvatarColors[u.username.toLowerCase()] = u.avatar_color;
    });
  }
  const onlineEl = document.getElementById("statOnline");
  if(onlineEl) onlineEl.textContent=data.total_online;
  const roomsEl = document.getElementById("statRooms");
  if(roomsEl) roomsEl.textContent=myRooms.length;
  updateTotalAlertBadge();
  renderDirectoryView();
}

let paletteActiveTab = "all"; // 'all', 'people', 'spaces', 'online'
let paletteItems = [];
let paletteSelectedIndex = 0;

function openPeopleSearch(){
  if(!authToken) return showToast("Only logged in accounts can search users", "ℹ️");
  paletteActiveTab = "all";
  updatePaletteTabsUI();
  const input = document.getElementById("userSearchInput");
  if(input) input.value = "";
  const clearBtn = document.getElementById("paletteClearBtn");
  if(clearBtn) clearBtn.style.display = "none";
  openOverlay("searchOverlay");
  renderPaletteSuggestions();
  setTimeout(()=>{
    if(input) { input.focus(); input.select(); }
  }, 120);
}

function clearPaletteSearch(){
  const input = document.getElementById("userSearchInput");
  if(input) {
    input.value = "";
    input.focus();
  }
  const clearBtn = document.getElementById("paletteClearBtn");
  if(clearBtn) clearBtn.style.display = "none";
  renderPaletteSuggestions();
}

function setPaletteTab(tab){
  paletteActiveTab = tab;
  updatePaletteTabsUI();
  const q = (document.getElementById("userSearchInput")?.value || "").trim();
  if(!q) renderPaletteSuggestions();
  else runUserSearch();
}

function updatePaletteTabsUI(){
  const tabs = ["all", "people", "spaces", "online"];
  tabs.forEach(t => {
    const el = document.getElementById(`palTab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if(el) el.classList.toggle("active", paletteActiveTab === t);
  });
}

function onPaletteKeyDown(e){
  if(e.key === "Escape"){
    e.preventDefault();
    closeOverlay("searchOverlay");
    return;
  }
  if(e.key === "ArrowDown"){
    e.preventDefault();
    if(paletteItems.length > 0){
      paletteSelectedIndex = (paletteSelectedIndex + 1) % paletteItems.length;
      updatePaletteSelection();
    }
    return;
  }
  if(e.key === "ArrowUp"){
    e.preventDefault();
    if(paletteItems.length > 0){
      paletteSelectedIndex = (paletteSelectedIndex - 1 + paletteItems.length) % paletteItems.length;
      updatePaletteSelection();
    }
    return;
  }
  if(e.key === "Enter"){
    e.preventDefault();
    if(paletteItems.length > 0 && paletteItems[paletteSelectedIndex]){
      executePaletteItem(paletteItems[paletteSelectedIndex]);
    }
    return;
  }
}

function updatePaletteSelection(){
  const rows = document.querySelectorAll(".palette-item-row");
  rows.forEach((r, idx) => {
    const isSelected = (idx === paletteSelectedIndex);
    r.classList.toggle("selected", isSelected);
    if(isSelected){
      r.scrollIntoView({ block: "nearest" });
    }
  });
}

function onPaletteItemClick(idx){
  if(paletteItems[idx]){
    executePaletteItem(paletteItems[idx]);
  }
}

function executePaletteItem(item){
  if(!item) return;
  if(item.type === "dm" || item.type === "space"){
    closeOverlay("searchOverlay");
    openRoom(item.id, item.name, item.is_dm);
  } else if(item.type === "user"){
    startDmWithUser(item.username);
  }
}

function renderPaletteSuggestions(){
  paletteItems = [];
  paletteSelectedIndex = 0;
  const c = document.getElementById("userSearchResults");
  if(!c) return;

  const sections = [];

  // 1. Direct Messages
  if(paletteActiveTab === "all" || paletteActiveTab === "people"){
    const dms = myRooms.filter(r => r.is_dm);
    if(dms.length > 0){
      sections.push({
        title: "Recent Direct Conversations",
        items: dms.map(r => ({
          type: "dm",
          id: r.id,
          name: r.name,
          username: r.name.replace(/^@/, ""),
          is_dm: true,
          sub: "Active Direct Message",
          online: false
        }))
      });
    }
  }

  // 2. Spaces & Channels
  if(paletteActiveTab === "all" || paletteActiveTab === "spaces"){
    const spaces = myRooms.filter(r => !r.is_dm);
    if(spaces.length > 0){
      sections.push({
        title: "Spaces & Channels",
        items: spaces.map(r => ({
          type: "space",
          id: r.id,
          name: r.name,
          is_dm: false,
          sub: r.id === "public" ? "Global Public Space" : "Encrypted Space"
        }))
      });
    }
  }

  // 3. Online Teammates / Directory
  if(paletteActiveTab === "all" || paletteActiveTab === "people" || paletteActiveTab === "online"){
    const dmsUsernames = new Set(myRooms.filter(r => r.is_dm).map(r => r.name.replace(/^@/, "").toLowerCase()));
    let users = (directoryCache || []).filter(u => u.username && u.username.toLowerCase() !== (myUser || "").toLowerCase());
    if(paletteActiveTab === "online"){
      users = users.filter(u => u.online);
    }
    const uncontacted = users.filter(u => !dmsUsernames.has(u.username.toLowerCase()));
    const displayUsers = (paletteActiveTab === "online" ? users : uncontacted).slice(0, 8);

    if(displayUsers.length > 0){
      sections.push({
        title: paletteActiveTab === "online" ? "Active Teammates Online" : "Suggested People & Contacts",
        items: displayUsers.map(u => ({
          type: "user",
          username: u.username,
          display_name: u.display_name,
          avatar_color: u.avatar_color,
          online: u.online,
          custom_status: u.custom_status,
          status_emoji: u.status_emoji,
          sub: u.custom_status ? `${u.status_emoji ? u.status_emoji + ' ' : ''}${u.custom_status}` : (u.online ? "● Online now" : "Offline")
        }))
      });
    }
  }

  renderPaletteContent(sections, "");
}

function runUserSearch(){
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async ()=>{
    const q = (document.getElementById("userSearchInput")?.value || "").trim();
    const clearBtn = document.getElementById("paletteClearBtn");
    if(clearBtn) clearBtn.style.display = q ? "flex" : "none";

    if(!q){
      renderPaletteSuggestions();
      return;
    }

    const c = document.getElementById("userSearchResults");
    if(!c) return;

    paletteItems = [];
    paletteSelectedIndex = 0;
    const sections = [];
    const lowerQ = q.toLowerCase();

    // 1. Search local channels/spaces
    if(paletteActiveTab === "all" || paletteActiveTab === "spaces"){
      const matchingSpaces = myRooms.filter(r => !r.is_dm && ((r.name && r.name.toLowerCase().includes(lowerQ)) || (r.id && r.id.toLowerCase().includes(lowerQ))));
      if(matchingSpaces.length > 0){
        sections.push({
          title: "Spaces & Channels",
          items: matchingSpaces.map(r => ({
            type: "space",
            id: r.id,
            name: r.name,
            is_dm: false,
            sub: r.id === "public" ? "Global Public Space" : "Encrypted Space"
          }))
        });
      }
    }

    // 2. Search local existing DMs
    let matchingDms = [];
    if(paletteActiveTab === "all" || paletteActiveTab === "people"){
      matchingDms = myRooms.filter(r => r.is_dm && r.name && r.name.toLowerCase().includes(lowerQ));
      if(matchingDms.length > 0){
        sections.push({
          title: "Direct Conversations",
          items: matchingDms.map(r => ({
            type: "dm",
            id: r.id,
            name: r.name,
            username: r.name.replace(/^@/, ""),
            is_dm: true,
            sub: "Direct Message Stream"
          }))
        });
      }
    }

    // 3. Search remote users via API
    if(paletteActiveTab === "all" || paletteActiveTab === "people" || paletteActiveTab === "online"){
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}&token=${encodeURIComponent(authToken)}`);
        if(res.ok){
          const d = await res.json();
          let users = d.users || [];
          if(paletteActiveTab === "online"){
            users = users.filter(u => u.online);
          }
          const existingDms = new Set(matchingDms.map(m => m.username.toLowerCase()));
          users = users.filter(u => u.username && u.username.toLowerCase() !== (myUser || "").toLowerCase() && !existingDms.has(u.username.toLowerCase()));

          if(users.length > 0){
            sections.push({
              title: "Registered Users",
              items: users.map(u => ({
                type: "user",
                username: u.username,
                display_name: u.display_name,
                avatar_color: u.avatar_color,
                online: u.online,
                custom_status: u.custom_status,
                status_emoji: u.status_emoji,
                sub: u.custom_status ? `${u.status_emoji ? u.status_emoji + ' ' : ''}${u.custom_status}` : (u.online ? "● Online now" : "Offline")
              }))
            });
          }
        }
      } catch(e) {}
    }

    renderPaletteContent(sections, q);
  }, 120);
}

function renderPaletteContent(sections, query){
  const c = document.getElementById("userSearchResults");
  const countEl = document.getElementById("paletteResultCount");
  if(!c) return;

  paletteItems = [];
  let totalItems = 0;
  sections.forEach(s => totalItems += s.items.length);

  if(countEl) {
    countEl.textContent = totalItems === 0 ? "No matches" : `${totalItems} ${totalItems === 1 ? 'match' : 'matches'}`;
  }

  if(sections.length === 0 || totalItems === 0){
    c.innerHTML = `
      <div style="text-align:center;padding:36px 16px;color:var(--muted-2);font-size:.85rem">
        <div style="font-size:1.8rem;margin-bottom:8px">🔍</div>
        <div>No matching conversations or users found.</div>
        <div style="font-size:.74rem;color:var(--muted);margin-top:4px">Try another search or select a different filter tab.</div>
      </div>
    `;
    return;
  }

  let html = "";
  let globalIndex = 0;

  sections.forEach(sec => {
    html += `<div class="palette-section-header">${esc(sec.title)}</div>`;
    sec.items.forEach(item => {
      paletteItems.push(item);
      const itemIdx = globalIndex++;
      const isSelected = (itemIdx === paletteSelectedIndex);

      if(item.type === "space"){
        const isPub = item.id === "public";
        html += `
          <div class="search-user-row palette-item-row ${isSelected ? 'selected' : ''}" onclick="onPaletteItemClick(${itemIdx})">
            <div class="palette-item-left">
              <div class="palette-item-icon ${isPub ? 'public' : 'space'}">#</div>
              <div class="palette-item-meta">
                <div class="palette-item-title-row">
                  <span class="palette-item-name">${highlightPaletteMatch(item.name, query)}</span>
                </div>
                <div class="palette-item-sub">${esc(item.sub)}</div>
              </div>
            </div>
            <div class="palette-item-right">
              <div class="palette-action-pill">Open <kbd>↵</kbd></div>
            </div>
          </div>
        `;
      } else {
        const u = item;
        if(u.avatar_color) window.userAvatarColors[u.username.toLowerCase()] = u.avatar_color;
        const bg = u.avatar_color || (window.userAvatarColors && window.userAvatarColors[u.username.toLowerCase()]) || avColor(u.username);
        const isDm = (u.type === "dm");
        const displayName = u.display_name || u.name || u.username;
        const presClass = u.online ? "online" : "offline";

        html += `
          <div class="search-user-row palette-item-row ${isSelected ? 'selected' : ''}" onclick="onPaletteItemClick(${itemIdx})">
            <div class="palette-item-left">
              <div class="palette-item-av" style="background:${bg}">
                ${esc(initials(u.username || displayName))}
                <span class="palette-pres-dot ${presClass}"></span>
              </div>
              <div class="palette-item-meta">
                <div class="palette-item-title-row">
                  <span class="palette-item-name">${highlightPaletteMatch(displayName, query)}</span>
                  <span class="palette-item-uname">@${highlightPaletteMatch(u.username, query)}</span>
                </div>
                <div class="palette-item-sub">
                  <span class="${u.online ? 'sub-status' : ''}">${esc(u.sub)}</span>
                </div>
              </div>
            </div>
            <div class="palette-item-right">
              <div class="palette-action-pill">${isDm ? 'Chat' : 'Message'} <kbd>↵</kbd></div>
              <button class="palette-profile-icon-btn" onclick="event.stopPropagation(); closeOverlay('searchOverlay'); openProfile('${esc(u.username)}', '${u.online ? 'here' : 'offline'}', false)" title="View Profile">
                👤
              </button>
            </div>
          </div>
        `;
      }
    });
  });

  c.innerHTML = html;
  updatePaletteSelection();
}

function highlightPaletteMatch(text, query){
  if(!text) return "";
  if(!query) return esc(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, "gi");
  return esc(text).replace(regex, `<span class="palette-highlight">$1</span>`);
}

async function startDmWithUser(u){
  closeOverlay("searchOverlay");
  const dmRoom = myRooms.find(r => r.is_dm && r.name.toLowerCase() === `@${u.toLowerCase()}`);
  if(dmRoom){
    openRoom(dmRoom.id, dmRoom.name, true);
    return;
  }
  try {
    const res = await fetch("/api/dm/request", {
      method: "POST",
      body: new URLSearchParams({ target: u, token: authToken })
    });
    const d = await res.json();
    if(d.status === "already_connected"){
      openRoom(d.room_id, d.room_name, true);
    } else {
      showToast(d.detail || `Chat request sent to @${u}`, "✉️");
      await fetchRequests();
    }
  } catch(e) {
    showToast("Network error initiating chat", "❌");
  }
}

function openProfile(u, presence="offline", isPrivateSpace=false){
  if(isGuestUser) return;
  window.targetProfile = u;
  document.getElementById("profName").textContent="@"+u;
  const bioEl = document.getElementById("profBio");
  bioEl.style.display = "none";
  bioEl.textContent = "";

  const customStatusEl = document.getElementById("profCustomStatusBadge");
  if(customStatusEl) {
    customStatusEl.style.display = "none";
    customStatusEl.textContent = "";
  }
  const metaRow = document.getElementById("profMetaRow");
  if(metaRow) metaRow.style.display = "none";

  let presClass = "pres-grey";
  let label = "Offline";
  let labelColor = "var(--offline)";

  if (!isPrivateSpace) {
    if (presence === "here" || presence === "online") {
      presClass = "pres-green";
      label = "● Online";
      labelColor = "var(--online)";
    }
  } else {
    if (presence === "here") {
      presClass = "pres-green";
      label = "● in this space";
      labelColor = "var(--online)";
    } else if (presence === "elsewhere") {
      presClass = "pres-orange";
      label = "● online elsewhere";
      labelColor = "var(--away)";
    }
  }

  renderAvatar(document.getElementById("profAvatar"), u, presClass);
  const statusEl = document.getElementById("profStatus");
  statusEl.textContent = label;
  statusEl.style.color = labelColor;

  const isConnected = myRooms.some(r => r.is_dm && r.name.toLowerCase() === `@${u.toLowerCase()}`);
  const callActions = document.getElementById("profCallActions");
  const dmBtn = document.getElementById("profDmBtn");

  if (u === myUser) {
    if (callActions) callActions.style.display = "none";
    if (dmBtn) dmBtn.style.display = "none";
  } else {
    if (callActions) callActions.style.display = isConnected ? "flex" : "none";
    if (dmBtn) {
      dmBtn.style.display = "block";
      dmBtn.textContent = isConnected ? "Open Direct Message" : "Request Chat Permission";
    }
  }

  openOverlay("profileOverlay");

  fetch(`/api/users/public_profile?username=${encodeURIComponent(u)}&token=${encodeURIComponent(authToken)}`)
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      if(!data || window.targetProfile !== u) return;
      if(data.avatar_color) {
        window.userAvatarColors[u.toLowerCase()] = data.avatar_color;
        renderAvatar(document.getElementById("profAvatar"), u, presClass, data.avatar_color);
      }
      if(data.display_name){
        document.getElementById("profName").innerHTML = `${esc(data.display_name)} <span style="color:var(--muted-2);font-weight:400">@${esc(u)}</span>`;
      }
      if(data.bio){
        bioEl.textContent = data.bio;
        bioEl.style.display = "block";
      }
      if(data.custom_status && customStatusEl){
        customStatusEl.textContent = `${data.status_emoji ? data.status_emoji + ' ' : ''}${data.custom_status}`;
        customStatusEl.style.display = "inline-flex";
      }
      if(data.created_at && metaRow){
        const dateStr = new Date(data.created_at * 1000).toLocaleDateString([], {month: 'short', year: 'numeric'});
        document.getElementById("profMemberSince").textContent = `🗓️ Member since ${dateStr}`;
        metaRow.style.display = "flex";
      }
    })
    .catch(()=>{});
}

function callFromProfile(type) {
  if (!window.targetProfile) return;
  const target = window.targetProfile;
  closeOverlay("profileOverlay");

  const dmRoom = myRooms.find(r => r.is_dm && r.name.toLowerCase() === `@${target.toLowerCase()}`);
  if (dmRoom) {
    openRoom(dmRoom.id, dmRoom.name, true);
  }
  const rtc = window.WebRTC || (typeof WebRTC !== "undefined" ? WebRTC : null);
  if (rtc && rtc.startCall) {
    setTimeout(() => {
      rtc.startCall(target, type);
    }, 250);
  }
}

async function requestChat(){
  if(!window.targetProfile) return;
  const res=await fetch("/api/dm/request",{method:"POST",body:new URLSearchParams({target:window.targetProfile,token:authToken})});
  const d=await res.json();
  closeOverlay("profileOverlay");
  if(d.status==="already_connected"){ openRoom(d.room_id,d.room_name,true); return; }
  showToast(d.detail||"Chat request sent.", "✉️");
}


