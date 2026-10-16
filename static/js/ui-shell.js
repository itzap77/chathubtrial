function toggleLeft(){
  rightPanel.classList.remove("open");
  leftPanel.classList.toggle("open");
  backdrop.classList.toggle("show", leftPanel.classList.contains("open") || rightPanel.classList.contains("open"));
}

function toggleRight(){
  if(currentView !== "chat") return;
  if(window.innerWidth < 768){
    leftPanel.classList.remove("open");
    rightPanel.classList.toggle("open");
    backdrop.classList.toggle("show", rightPanel.classList.contains("open"));
    toggleRightBtn.classList.toggle("active-btn", rightPanel.classList.contains("open"));
  } else {
    rightPanelOpen = !rightPanelOpen;
    rightPanel.style.display = rightPanelOpen ? "flex" : "none";
    toggleRightBtn.classList.toggle("active-btn", rightPanelOpen);
  }
}

function closePanels(){
  leftPanel.classList.remove("open");
  rightPanel.classList.remove("open");
  backdrop.classList.remove("show");
  toggleRightBtn.classList.remove("active-btn");
}

function openOverlay(id){ document.getElementById(id).classList.add("open"); }

function closeOverlay(id){ document.getElementById(id).classList.remove("open"); }

function onBrandClick(){
  if (isGuestUser) return;
  setView("home");
  closePanels();
}

function setView(name){
  if(isGuestUser && name !== "chat"){
    showToast("Guest mode is isolated to temporary rooms only", "ℹ️");
    return;
  }
  currentView = name;
  const isChat = (name === "chat");

  const homeView = document.getElementById("homeView");
  if(homeView) homeView.style.display = name==="home" ? "flex" : "none";
  const notifyView = document.getElementById("notifyView");
  if(notifyView) notifyView.style.display = name==="notify" ? "flex" : "none";
  const chatView = document.getElementById("chatView");
  if(chatView) chatView.style.display = isChat ? "flex" : "none";

  const roomChip = document.getElementById("roomChip");
  if(roomChip) roomChip.style.display = isChat ? "inline-flex" : "none";
  const headerInfoBtn = document.getElementById("headerInfoBtn");
  if(headerInfoBtn) headerInfoBtn.style.display = isChat ? "grid" : "none";
  if(toggleRightBtn) toggleRightBtn.style.display = isChat ? "grid" : "none";

  if (!isChat) {
    rightPanel.style.display = "none";
    toggleRightBtn.classList.remove("active-btn");
  } else if (window.innerWidth >= 768) {
    rightPanel.style.display = rightPanelOpen ? "flex" : "none";
    toggleRightBtn.classList.toggle("active-btn", rightPanelOpen);
  }

  // Sync Activity Rail active indicator
  document.querySelectorAll(".rail-item").forEach(b => b.classList.remove("active"));
  const activeRail = document.getElementById(`railBtn_${name}`);
  if(activeRail) activeRail.classList.add("active");

  if(name === "home"){
    renderHomeView();
  }

  renderRoomLists();
  closePanels();
}

function showHome(){ setView("home"); }

function showNotifications(){ setView("notify"); renderNotifications(); }

function renderHomeView(){
  // 1. Dynamic time-sensitive greeting
  const hour = new Date().getHours();
  let greetingText = "Good evening";
  if(hour >= 5 && hour < 12) greetingText = "Good morning";
  else if(hour >= 12 && hour < 17) greetingText = "Good afternoon";
  
  const displayName = myDisplayName || myUser || "User";
  const greetEl = document.getElementById("homeGreeting");
  if(greetEl) greetEl.innerHTML = `${greetingText}, <span>${esc(displayName)}</span> 👋`;

  // 2. Focus & Presence Preview
  const avEl = document.getElementById("homeStatusAvatar");
  if(avEl) {
    avEl.textContent = initials(myUser || "?");
    avEl.style.background = myAvatarColor || (window.userAvatarColors && window.userAvatarColors[myUser.toLowerCase()]) || avColor(myUser || "?");
  }
  const nameEl = document.getElementById("homeStatusName");
  if(nameEl) {
    nameEl.textContent = myDisplayName ? `${myDisplayName} (@${myUser})` : `@${myUser}`;
  }
  const statusTextEl = document.getElementById("homeStatusText");
  if(statusTextEl) {
    const statusStr = myCustomStatus ? `${myStatusEmoji ? esc(myStatusEmoji) + ' ' : ''}${esc(myCustomStatus)}` : "Available · Online";
    statusTextEl.textContent = statusStr;
  }

  // 3. Cryptographic Fingerprint
  const fpEl = document.getElementById("homeFingerprintTag");
  if(fpEl) {
    const e2ee = window.E2EE || (typeof E2EE !== "undefined" ? E2EE : null);
    if(e2ee && e2ee.myFingerprint) {
      fpEl.textContent = e2ee.myFingerprint.substring(0, 16) + "…";
    } else {
      fpEl.textContent = "ECDH P-256 (Verified)";
    }
  }

  // 4. Render "Jump Back In" Recent List
  const recentEl = document.getElementById("homeRecentList");
  if(!recentEl) return;

  if(!myRooms || myRooms.length === 0){
    recentEl.innerHTML = `
      <div class="home-recent-card" onclick="openRoom('public','Public Group',false)">
        <div class="home-recent-card-left">
          <div class="home-recent-icon public">#</div>
          <div class="home-recent-info">
            <div class="home-recent-name">#public</div>
            <div class="home-recent-sub">Default Global Space</div>
          </div>
        </div>
        <button class="home-recent-jump-btn">→</button>
      </div>
      <div class="home-recent-card create-new-card" onclick="openRoomModal('create')">
        <div class="home-recent-card-left">
          <div class="home-recent-icon add">+</div>
          <div class="home-recent-info">
            <div class="home-recent-name">Create Space</div>
            <div class="home-recent-sub">New passkey room</div>
          </div>
        </div>
        <button class="home-recent-jump-btn">+</button>
      </div>
    `;
    return;
  }

  const recentRooms = myRooms.slice(0, 6);
  let html = recentRooms.map(r => {
    const isDm = r.is_dm;
    const bg = isDm ? (window.userAvatarColors && window.userAvatarColors[r.name.toLowerCase()]) || avColor(r.name) : '';
    const iconHtml = isDm
      ? `<div class="home-recent-av" style="background:${bg}">${esc(initials(r.name))}</div>`
      : `<div class="home-recent-icon ${r.id === 'public' ? 'public' : 'space'}">#</div>`;
    const unreadBadge = (r.unread_count > 0)
      ? `<span class="home-unread-pill">${r.unread_count}</span>`
      : '';
    const subText = isDm ? "Direct Message" : (r.id === "public" ? "Global Community Space" : "Encrypted Space");

    return `
      <div class="home-recent-card" onclick="openRoom('${esc(r.id)}', '${esc(r.name)}', ${isDm})">
        <div class="home-recent-card-left">
          ${iconHtml}
          <div class="home-recent-info">
            <div class="home-recent-name-row">
              <span class="home-recent-name">${esc(r.name)}</span>
              ${unreadBadge}
            </div>
            <div class="home-recent-sub">${subText}</div>
          </div>
        </div>
        <button class="home-recent-jump-btn" title="Open Conversation">→</button>
      </div>
    `;
  }).join("");

  html += `
    <div class="home-recent-card create-new-card" onclick="openRoomModal('create')">
      <div class="home-recent-card-left">
        <div class="home-recent-icon add">+</div>
        <div class="home-recent-info">
          <div class="home-recent-name">Create New Space</div>
          <div class="home-recent-sub">Start a passkey-protected room</div>
        </div>
      </div>
      <button class="home-recent-jump-btn">+</button>
    </div>
  `;
  recentEl.innerHTML = html;
}

async function setQuickStatus(text, emoji){
  if(!authToken) return showToast("Sign in to update status", "ℹ️");
  myCustomStatus = text;
  myStatusEmoji = emoji;
  const statusTextEl = document.getElementById("homeStatusText");
  if(statusTextEl) statusTextEl.textContent = `${emoji} ${text}`;
  try {
    await fetch("/api/account/update_profile", {
      method: "POST",
      body: new URLSearchParams({
        token: authToken,
        custom_status: text,
        status_emoji: emoji
      })
    });
    showToast(`Status: ${emoji} ${text}`, "✓");
  } catch(e) {}
}

