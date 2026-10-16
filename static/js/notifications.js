function setNotifyFilter(f){
  activeNotifyFilter = f;
  const tabs = {
    all: "tabAll",
    requests: "tabRequests",
    mentions: "tabMentions",
    system: "tabSystem"
  };
  Object.keys(tabs).forEach(k => {
    const el = document.getElementById(tabs[k]);
    if(el) el.classList.toggle("active", f === k);
  });
  renderNotifications();
}

function pushActivityNotification(category, title, text, payload=null){
  activityFeed.unshift({
    id: Date.now() + Math.random(),
    category,
    title,
    text,
    time: Date.now() / 1000,
    payload
  });
  updateTotalAlertBadge();
  if (currentView === "notify") renderNotifications();
}

function clearActivityFeed(){
  activityFeed = [];
  renderNotifications();
  updateTotalAlertBadge();
  showToast("Activity history cleared", "✓");
}

function removeActivityNotification(id, e){
  if(e) e.stopPropagation();
  activityFeed = activityFeed.filter(a => a.id !== id);
  renderNotifications();
  updateTotalAlertBadge();
}

function updateTotalAlertBadge(){
  const total = pendingRequests.length + activityFeed.length;
  const badge = document.getElementById("reqBadge");
  if(badge){
    badge.style.display = total > 0 ? "grid" : "none";
    badge.textContent = total > 99 ? "99+" : total;
  }
  const reqTag = document.getElementById("reqCountTag");
  if(reqTag) {
    reqTag.textContent = `${pendingRequests.length}`;
    reqTag.classList.toggle("has-unread", pendingRequests.length > 0);
  }
}

function renderNotifications(){
  const feed = document.getElementById("notificationsFeed");
  if(!feed) return;
  let items = [];

  if (activeNotifyFilter === "all" || activeNotifyFilter === "requests") {
    pendingRequests.forEach(r => {
      items.push({
        type: "request",
        raw: r,
        time: r.created_at
      });
    });
  }

  if (activeNotifyFilter === "all" || activeNotifyFilter === "mentions" || activeNotifyFilter === "system") {
    activityFeed.forEach(a => {
      const isMention = a.category === "mention";
      const isSystem = a.category !== "mention" && a.category !== "request";
      if (activeNotifyFilter === "all" || (activeNotifyFilter === "mentions" && isMention) || (activeNotifyFilter === "system" && isSystem)) {
        items.push({
          type: a.category,
          activity: a,
          time: a.time
        });
      }
    });
  }

  items.sort((a, b) => b.time - a.time);

  if (!items.length) {
    feed.innerHTML = `
      <div class="notify-empty-state">
        <div class="notify-empty-icon">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
        </div>
        <h3>All caught up!</h3>
        <p>No notifications in this category. Direct chat requests, mentions, and system updates will be logged here.</p>
      </div>
    `;
    return;
  }

  feed.innerHTML = items.map(item => {
    if (item.type === "request") {
      const r = item.raw;
      return `
        <div class="notify-card">
          <div class="notify-card-left">
            <div class="av pres-green notify-avatar" style="background:${avColor(r.sender)};color:#fff">${esc(initials(r.sender))}</div>
            <div class="notify-card-body">
              <div class="notify-card-title-row">
                <span class="notify-user">@${esc(r.sender)}</span>
                <span class="notify-chip req">Invitation</span>
                <span class="notify-time">${fmtTime(r.created_at)}</span>
              </div>
              <div class="notify-card-text">Invited you to start a private encrypted 1-on-1 direct message.</div>
            </div>
          </div>
          <div class="notify-card-actions">
            <button class="notify-btn-accept" onclick="respondRequest(${r.id},'accept')">Accept</button>
            <button class="notify-btn-decline" onclick="respondRequest(${r.id},'reject')">Decline</button>
          </div>
        </div>
      `;
    } else {
      const a = item.activity;
      const isMention = a.category === "mention";
      return `
        <div class="notify-card">
          <div class="notify-card-left">
            <div class="notify-icon-box ${isMention ? 'mention' : 'system'}">
              ${isMention 
                ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>`
                : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
              }
            </div>
            <div class="notify-card-body">
              <div class="notify-card-title-row">
                <span class="notify-user">${esc(a.title)}</span>
                <span class="notify-chip ${isMention ? 'mention' : 'system'}">${esc(a.category || 'system')}</span>
                <span class="notify-time">${fmtTime(a.time)}</span>
              </div>
              <div class="notify-card-text">${esc(a.text)}</div>
            </div>
          </div>
          <div class="notify-card-actions">
            ${a.payload && a.payload.room_id ? `<button class="notify-btn-jump" onclick="openRoom('${esc(a.payload.room_id)}','${esc(a.payload.room_name || 'Space')}',false)">Jump to Space</button>` : ''}
            <button class="notify-del-btn" onclick="removeActivityNotification(${a.id}, event)" title="Dismiss">✕</button>
          </div>
        </div>
      `;
    }
  }).join("");
}

async function fetchRequests(){
  if(!authToken) return;
  const res=await fetch(`/api/dm/requests?token=${encodeURIComponent(authToken)}`);
  if(!res.ok) return;
  pendingRequests=await res.json();
  updateTotalAlertBadge();
  if(currentView==="notify") renderNotifications();
}

async function respondRequest(id,action){
  const res=await fetch("/api/dm/respond",{method:"POST",body:new URLSearchParams({request_id:id,action,token:authToken})});
  const data=await res.json();
  await Promise.all([fetchRequests(),fetchMyRooms()]);
  if(action==="accept" && data.room_id) openRoom(data.room_id,data.room_name,true);
}

