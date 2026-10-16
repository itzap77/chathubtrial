function triggerEventTicker(text){
  const el = document.getElementById("eventTicker");
  document.getElementById("eventTickerText").textContent = text;
  el.classList.add("show");
  clearTimeout(tickerTimer);
  tickerTimer = setTimeout(()=>{ el.classList.remove("show"); }, 3500);
}

function emitTyping(){
  const now = Date.now();
  if(ws && ws.readyState===1 && now - lastTypingSent > 2000){
    lastTypingSent = now;
    ws.send(JSON.stringify({type:"typing"}));
  }
}

function setReplyTarget(id, sender, text){
  activeReply = { id, sender, text };
  document.getElementById("replyTargetUser").textContent = `Replying to @${sender}`;
  document.getElementById("replyTargetText").textContent = text || "[Attachment]";
  document.getElementById("replyDock").classList.add("show");
  document.getElementById("chatInput").focus();
}

function cancelReply(){
  activeReply = null;
  document.getElementById("replyDock").classList.remove("show");
}

async function toggleInlineReaders(msgId){
  const tag = document.getElementById(`readers_${msgId}`);
  if (!tag) return;

  if (tag.classList.contains("show")) {
    tag.classList.remove("show");
    return;
  }

  try {
    const res = await fetch(`/api/messages/readers?message_id=${msgId}&token=${encodeURIComponent(authToken)}`);
    if (!res.ok) return;
    const d = await res.json();
    if (!d.readers || !d.readers.length) {
      tag.textContent = "Not read by anyone yet";
    } else {
      tag.textContent = `Read by: @${d.readers.join(", @")}`;
    }
    tag.classList.add("show");
  } catch(e) {}
}

function onComposerInput(input){
  emitTyping();
  const val = input.value;
  const cursor = input.selectionStart;
  const textBefore = val.slice(0, cursor);
  const atIdx = textBefore.lastIndexOf("@");

  if (atIdx !== -1 && (atIdx === 0 || /\s/.test(textBefore[atIdx - 1]))) {
    const query = textBefore.slice(atIdx + 1).toLowerCase();
    mentionMatchStart = atIdx;
    
    const activeAlias = (getActiveRoomAlias() || "").toLowerCase();
    const matches = roomMembersCache.filter(u => u && u.toLowerCase() !== activeAlias && u.toLowerCase().startsWith(query));
    
    if (matches.length > 0) {
      showMentionMenu(matches);
      return;
    }
  }
  hideMentionMenu();
}

function showMentionMenu(matches){
  const menu = document.getElementById("mentionMenu");
  mentionSelectedIndex = 0;
  menu.innerHTML = matches.map((m, idx) => `
    <div class="mention-item ${idx === 0 ? 'selected' : ''}" onclick="insertMention('${esc(m)}')">
      <div class="av pres-green" style="width:24px;height:24px;font-size:.68rem;background:${avColor(m)};color:#fff">${esc(initials(m))}</div>
      <span style="font-weight:600">@${esc(m)}</span>
    </div>
  `).join("");
  menu.classList.add("show");
}

function hideMentionMenu(){
  document.getElementById("mentionMenu").classList.remove("show");
  mentionMatchStart = -1;
}

function insertMention(username){
  const input = document.getElementById("chatInput");
  const val = input.value;
  const before = val.slice(0, mentionMatchStart);
  const after = val.slice(input.selectionStart);
  
  input.value = `${before}@${username} ${after}`;
  hideMentionMenu();
  input.focus();
  const newPos = before.length + username.length + 2;
  input.setSelectionRange(newPos, newPos);
}

function onComposerKeyDown(e){
  const menu = document.getElementById("mentionMenu");
  if (menu.classList.contains("show")) {
    const items = menu.querySelectorAll(".mention-item");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      mentionSelectedIndex = (mentionSelectedIndex + 1) % items.length;
      updateSelectedMention(items);
      return;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      mentionSelectedIndex = (mentionSelectedIndex - 1 + items.length) % items.length;
      updateSelectedMention(items);
      return;
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (items[mentionSelectedIndex]) {
        items[mentionSelectedIndex].click();
      }
      return;
    } else if (e.key === "Escape") {
      hideMentionMenu();
      return;
    }
  }

  if (e.key === "Enter") {
    e.preventDefault();
    sendMsg();
  }
}

function updateSelectedMention(items){
  items.forEach((it, idx) => {
    it.classList.toggle("selected", idx === mentionSelectedIndex);
  });
}

function connectRoom(id,title,isDm){
  closeMessageSearch();
  if(ws) ws.close();
  currentRoom=id; currentRoomTitle=title; currentRoomIsDm=isDm;
  
  const isEphemeral = id.startsWith("tmp_");
  const activeAlias = getActiveRoomAlias();

  const chip = document.getElementById("roomChip");
  chip.classList.toggle("eph", isEphemeral);
  if(id === "public" || isDm) {
    chip.style.display = "none";
  } else {
    chip.style.display = "inline-flex";
    chip.textContent = isEphemeral ? "⚡ " + id : "🔑 " + id;
  }

  const prefixSymbol = document.querySelector(".chat-prefix-symbol");
  if(prefixSymbol) prefixSymbol.textContent = isDm ? "@" : (isEphemeral ? "⚡" : "#");
  
  document.getElementById("chatTitle").textContent = title;
  document.getElementById("chatSub").textContent = isEphemeral 
    ? `Ephemeral Space · Identity: @${activeAlias}` 
    : (id==="public" ? "Open channel · 48h auto-purge" : (isDm ? "Direct 1-on-1 private session" : `Key: ${id}`));

  const btnAudio = document.getElementById("btnAudioCall");
  const btnVideo = document.getElementById("btnVideoCall");
  const e2eeBadge = document.getElementById("e2eeBadge");

  if (isDm) {
    if (btnAudio) btnAudio.style.display = "grid";
    if (btnVideo) btnVideo.style.display = "grid";
    if (e2eeBadge) e2eeBadge.style.display = "inline-flex";
  } else {
    if (btnAudio) btnAudio.style.display = "none";
    if (btnVideo) btnVideo.style.display = "none";
    if (e2eeBadge) {
      e2eeBadge.style.display = (id !== "public") ? "inline-flex" : "none";
    }
  }
  
  document.getElementById("messages").innerHTML="";
  document.getElementById("typingBar").style.display="none";
  document.getElementById("eventTicker").classList.remove("show");
  cancelReply();
  hideMentionMenu();
  renderRoomLists();

  const proto=location.protocol==="https:"?"wss:":"ws:";
  let authQuery = `?client_id=${myClientId}`;
  if (authToken && !isEphemeral) {
    authQuery += `&token=${encodeURIComponent(authToken)}`;
  }

  const connUser = isEphemeral ? activeAlias : myUser;

  ws=new WebSocket(`${proto}//${location.host}/ws/${id}/${encodeURIComponent(connUser)}${authQuery}`);
  window.ws = ws;
  window.activeWs = ws;
  
  ws.onclose = (e) => {
    if (e.code === 4004 || e.code === 4003) {
      showToast(e.reason || "Access denied or room expired.", "⚠️");
      if (id.startsWith("tmp_")) unpinEphemeralRoom(id);
      if (id !== "public" && !isGuestUser) openRoom("public", "Public Group", false);
    }
  };

  ws.onmessage=async (e)=>{
    const d=JSON.parse(e.data);
    const activeAliasNow = getActiveRoomAlias();

    if(d.type==="init"){
      if(d.assigned_username && !isEphemeral){
        myUser = d.assigned_username;
        refreshSidebarIdentity();
      }

      if(id.startsWith("dm_")){
        const raw = id.replace("dm_", "");
        const parts = raw.includes("__") ? raw.split("__") : raw.split("_");
        const otherUser = parts[0].toLowerCase() === activeAliasNow.toLowerCase() ? parts[1] : parts[0];
        currentRoomTitle = "@" + otherUser;
        document.getElementById("chatTitle").textContent = currentRoomTitle;
        chip.textContent = currentRoomTitle;
      }

      currentCreator=d.created_by;
      amIRoomAdmin = !!d.is_admin;
      document.getElementById("messages").innerHTML="";
      if (d.messages && d.messages.length > 0) {
        for (const m of d.messages) {
          await addBubble(m, m.sender===activeAliasNow, false);
        }
      } else {
        renderWelcomeBanner(currentRoomTitle, currentRoomIsDm);
      }
      
      if(d.members) roomMembersCache = d.members;
      syncSpaceInspector();
    } else if(d.type==="chat"){
      const isMe = (d.sender_cid && d.sender_cid === myClientId) || (d.sender === activeAliasNow);
      await addBubble(d, isMe, true);
      
      if (!isMe) {
        const isMentioned = d.mentions && d.mentions.map(m=>m.toLowerCase()).includes(activeAliasNow.toLowerCase());
        
        if (currentRoom !== "public" || isMentioned) {
          playNotifySound(isMentioned);
        }

        // Add to notification center only if message is inside current room
        if (isMentioned && d.room_id === currentRoom) {
          showToast(`@${d.sender} tagged you in ${currentRoomTitle}`, "🔔");
          pushActivityNotification(
            "mention",
            `@${d.sender} tagged you in ${currentRoomTitle}`,
            d.text || "Mentioned you in a message",
            { room_id: currentRoom, room_name: currentRoomTitle }
          );
        }

        if (document.hidden) {
          unreadCount++;
          document.title = `(${unreadCount}) ChatHub • @${d.sender} messaged!`;

          if ("Notification" in window && Notification.permission === "granted" && (currentRoom !== "public" || isMentioned)) {
            new Notification(`@${d.sender} in ${currentRoomTitle}`, {
              body: d.text || (d.filename ? `[File] ${d.original_name}` : "Sent a message"),
              icon: "/favicon.ico"
            });
          }
        }
        
        if (d.id) {
          ws.send(JSON.stringify({type:"read_ack", message_id: d.id}));
        }
      }
    } else if(d.type==="user_mentioned"){
      // Cross-room mention alert handler (only trigger if not viewing this room)
      if(currentRoom !== d.room_id){
        playNotifySound(true);
        showToast(`@${d.by} tagged you in a message!`, "🔔");
        pushActivityNotification(
          "mention",
          `@${d.by} tagged you`,
          d.text || "Mentioned you in a message",
          { room_id: d.room_id, room_name: d.room_id === "public" ? "Public Group" : d.room_id }
        );
      }
    } else if(d.type==="typing"){
      const isMe = (d.sender_cid && d.sender_cid === myClientId) || (d.sender === activeAliasNow);
      if(!isMe){
        document.getElementById("typingUser").textContent = d.sender;
        document.getElementById("typingBar").style.display = "flex";
        clearTimeout(typingTimer);
        typingTimer = setTimeout(()=>{ document.getElementById("typingBar").style.display = "none"; }, 2500);
      }
    } else if(d.type==="read_ack"){
      const tick = document.querySelector(`.tick[data-msg-id="${d.message_id}"]`);
      if(tick){
        tick.textContent = "✓✓";
        tick.className = "tick stage-2";
      }
    } else if(d.type==="all_read_ack"){
      document.querySelectorAll(".msg-group.me .tick").forEach(c => {
        c.textContent = "✓✓";
        c.className = "tick stage-2";
      });
    } else if(d.type==="presence_sync"){
      if(d.members) roomMembersCache = d.members;
      syncSpaceInspector();
    } else if(d.type==="system"){
      triggerEventTicker(d.text);
      syncSpaceInspector();
    } else if(d.type==="dm_request_received"){
      fetchRequests();
      playNotifySound(true);
      showToast(`@${d.from} requested chat permission.`, "✉️");
    } else if(d.type==="dm_request_accepted"){
      fetchMyRooms();
      playNotifySound(true);
      showToast(`@${d.by} accepted your request.`, "🤝");
      pushActivityNotification("system", `@${d.by} accepted invitation`, "Direct message stream unlocked");
    } else if(d.type==="kicked"){
      showToast(d.reason || "You were removed from this room.", "🚫");
      fetchMyRooms();
      if (!isGuestUser) openRoom("public","Public Group",false);
    } else if(d.type==="room_destructed"){
      showToast(d.detail, "⚠️");
      unpinEphemeralRoom(d.room_id);
      fetchMyRooms();
      if (!isGuestUser) openRoom("public","Public Group",false);
    } else if(d.type==="webrtc_signal"){
      const rtc = window.WebRTC || (typeof WebRTC !== "undefined" ? WebRTC : null);
      if(rtc) rtc.handleSignal(d);
    }
  };
}


async function sendMsg(){
  const input=document.getElementById("chatInput"), text=input.value.trim();
  if(!text||!ws||ws.readyState!==1) return;

  let outboundText = text;

  // E2EE Encryption check
  if(window.E2EE){
    try {
      if(currentRoomIsDm){
        const otherUser = currentRoomTitle.replace("@", "").trim();
        const dmKey = await E2EE.getDmSharedKey(otherUser, authToken);
        if(dmKey){
          outboundText = await E2EE.encrypt(text, dmKey);
        }
      } else if(E2EE.hasRoomKey(currentRoom)){
        const roomKey = await E2EE.deriveRoomKey(currentRoom, "");
        if(roomKey){
          outboundText = await E2EE.encrypt(text, roomKey);
        }
      }
    } catch(e) {
      console.warn("E2EE send error:", e);
    }
  }

  ws.send(JSON.stringify({
    type: "chat",
    text: outboundText,
    reply_to: activeReply
  }));
  input.value="";
  cancelReply();
  hideMentionMenu();
}

async function uploadSelectedFile(input){
  if(!input.files || !input.files[0]) return;
  const file = input.files[0];
  const formData = new FormData();
  formData.append("file", file);
  formData.append("token", authToken);
  formData.append("room_id", currentRoom);
  formData.append("guest_user", getActiveRoomAlias());
  formData.append("client_id", myClientId);
  if (activeReply) {
    formData.append("reply_to_id", activeReply.id);
    formData.append("reply_to_sender", activeReply.sender);
    formData.append("reply_to_text", activeReply.text);
  }
  input.value = "";
  try {
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if(!res.ok) showToast("Upload rejected (100MB max limit)", "❌");
    cancelReply();
  } catch(e) {
    showToast("Upload failed", "❌");
  }
}

function renderWelcomeBanner(title, isDm){
  const box = document.getElementById("messages");
  if(!box) return;
  const isPublic = (currentRoom === "public");
  const isEph = currentRoom.startsWith("tmp_");

  let icon = isDm ? "@" : (isEph ? "⚡" : "#");
  let heading = isDm ? `Direct Chat with ${title}` : `Welcome to ${title}!`;
  let desc = isDm
    ? `This is the beginning of your direct, encrypted messaging history with ${title}.`
    : (isPublic
      ? "Welcome to the public community channel. Messages in this space auto-purge after 48 hours."
      : (isEph
        ? "This is an instant disposable ephemeral room. All messages and media self-destruct when all participants leave."
        : `This is the beginning of the ${title} space. Send a message to start collaborating!`));

  const banner = document.createElement("div");
  banner.className = "chat-welcome-banner";
  banner.innerHTML = `
    <div class="welcome-banner-icon">${icon}</div>
    <h2 class="welcome-banner-title">${esc(heading)}</h2>
    <p class="welcome-banner-desc">${esc(desc)}</p>
  `;
  box.appendChild(banner);
}

async function addBubble(msg, isMe, isNew=false){
  const box=document.getElementById("messages");
  const welcome = box ? box.querySelector(".chat-welcome-banner") : null;
  if(welcome && isNew) welcome.remove();

  const row=document.createElement("div");
  const activeAliasNow = getActiveRoomAlias();
  
  const isMentioned = msg.mentions && msg.mentions.map(m=>m.toLowerCase()).includes(activeAliasNow.toLowerCase());
  row.className=`msg-group ${isMe?"me":"them"} ${isNew?"new-entry":""} ${isMentioned?"mentioned":""}`;
  
  let content = "";

  if(msg.reply_to && msg.reply_to.id){
    content += `
      <div class="reply-quote">
        <span class="reply-quote-sender">@${esc(msg.reply_to.sender)}</span>
        <span class="reply-quote-text">${esc(msg.reply_to.text || '[Attachment]')}</span>
      </div>`;
  }

  if(msg.text && typeof msg.text === "string" && msg.text.startsWith("call_log:")){
    try {
      const logData = JSON.parse(msg.text.substring(9));
      const isMissed = logData.status === "missed" || logData.status === "declined";
      const icon = logData.type === "video" ? "📹" : "📞";
      const title = logData.type === "video" 
        ? (isMissed ? (logData.status === "declined" ? "Declined Video Call" : "Missed Video Call") : "Video Call Ended")
        : (isMissed ? (logData.status === "declined" ? "Declined Voice Call" : "Missed Voice Call") : "Voice Call Ended");
      const sub = logData.duration ? `Duration: ${logData.duration}` : (logData.status === "declined" ? "Declined by recipient" : "No answer");
      const partner = isMe ? (currentRoomTitle.replace("@", "").trim()) : msg.sender;

      content += `
        <div class="call-log-card ${isMissed ? 'missed' : 'completed'}">
          <div class="call-log-icon">${icon}</div>
          <div class="call-log-meta">
            <div class="call-log-title">${title}</div>
            <div class="call-log-sub">${esc(sub)}</div>
          </div>
          <button class="call-log-action-btn" onclick="WebRTC.startCall('${esc(partner)}', '${esc(logData.type)}')">
            Call back
          </button>
        </div>`;
    } catch(e) {
      content += `<div class="msg-text">${esc(msg.text)}</div>`;
    }
  } else if(msg.text){
    let displayText = msg.text;
    let isEncrypted = false;
    let isLocked = false;

    if(typeof msg.text === "string" && msg.text.startsWith("e2ee:") && window.E2EE){
      try {
        let cryptoKey = null;
        if(currentRoomIsDm){
          const otherUser = currentRoomTitle.replace("@", "").trim();
          cryptoKey = await E2EE.getDmSharedKey(otherUser, authToken);
        } else if(E2EE.hasRoomKey(currentRoom)){
          cryptoKey = await E2EE.deriveRoomKey(currentRoom, "");
        }

        const res = await E2EE.decrypt(msg.text, cryptoKey);
        displayText = res.text;
        isEncrypted = res.isEncrypted;
        isLocked = res.locked;
      } catch(e) {
        displayText = "🔒 Encrypted Message";
        isEncrypted = true;
        isLocked = true;
      }
    }

    if(isEncrypted){
      content += `<div class="msg-text" data-raw-text="${esc(displayText)}"><span class="msg-e2ee-tag ${isLocked ? 'locked' : ''}" title="${isLocked ? 'Encrypted' : 'End-to-End Encrypted'}">🔒</span><span class="msg-text-content">${esc(displayText)}</span></div>`;
    } else {
      content += `<div class="msg-text" data-raw-text="${esc(displayText)}"><span class="msg-text-content">${esc(displayText)}</span></div>`;
    }
  }

  if(msg.filename){
    const fn = msg.filename.toLowerCase();
    const displayName = msg.original_name || msg.filename;
    
    if(fn.match(/\.(flac|mp3|wav|ogg|m4a|aac)$/i)){
      content += `
        <div class="audio-player-box">
          <div style="font-size:.74rem;color:var(--text);margin-bottom:4px;font-weight:600">🎵 <span class="msg-text-content" data-raw-text="${esc(displayName)}">${esc(displayName)}</span></div>
          <audio controls preload="metadata">
            <source src="/uploads/${msg.filename}">
          </audio>
        </div>`;
    } 
    else if(fn.match(/\.(png|jpg|jpeg|gif|webp)$/i)){
      content += `
        <div class="bubble-media">
          <a href="/uploads/${msg.filename}" target="_blank" title="View image">
            <img src="/uploads/${msg.filename}" alt="${esc(displayName)}" loading="lazy" />
          </a>
        </div>`;
    } 
    else {
      content += `
        <a class="file-chip" href="/uploads/${msg.filename}" download="${esc(displayName)}" title="Download attachment">
          <span class="file-chip-icon">📁</span>
          <div class="file-chip-meta">
            <span class="file-chip-name msg-text-content" data-raw-text="${esc(displayName)}">${esc(displayName)}</span>
            <span class="file-chip-sub">Click to download</span>
          </div>
          <span class="file-chip-arrow">↓</span>
        </a>`;
    }
  }

  let tickMarkup = "";
  if(isMe){
    const stage = msg.is_read >= 2 ? 2 : (msg.is_read === 1 ? 1 : 0);
    const tickIcon = stage === 0 ? "✓" : "✓✓";
    tickMarkup = `<span class="tick stage-${stage}" data-msg-id="${msg.id||''}" onclick="toggleInlineReaders(${msg.id||0})" title="Click to view readers">${tickIcon}</span>`;
  }

  const replyBtn = `<button class="reply-action-btn" onclick="setReplyTarget(${msg.id||0}, '${esc(msg.sender)}', '${esc(msg.text || (msg.filename ? '[Attachment]' : ''))}')" title="Reply">↩</button>`;

  const senderTitle = msg.sender_display ? `${esc(msg.sender_display)} <span class="sender-handle">@${esc(msg.sender)}</span>` : `@${esc(msg.sender)}`;
  const avatarHtml = `<div class="msg-avatar av" style="background:${avColor(msg.sender)};color:#fff" onclick="${currentRoom.startsWith('tmp_') ? '' : `openProfile('${esc(msg.sender)}')`}" title="View profile">${esc(initials(msg.sender))}</div>`;

  row.innerHTML = `
    ${avatarHtml}
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-sender">${senderTitle}</span>
        <span class="msg-time">${fmtTime(msg.timestamp)}</span>
        ${tickMarkup}
      </div>
      <div class="msg-content-wrapper">
        <div class="msg-bubble ${isMe ? 'bubble-me' : 'bubble-them'} ${(!msg.text && msg.filename) ? 'bubble-media-only' : ''}">
          ${content}
        </div>
        <div class="msg-actions">${replyBtn}</div>
      </div>
      <div class="read-by-tag" id="readers_${msg.id||0}"></div>
    </div>
  `;
  box.appendChild(row); 
  box.scrollTop=box.scrollHeight;
}

function getDmPartnerUsername() {
  if (currentRoom && currentRoom.startsWith("dm_")) {
    const raw = currentRoom.substring(3);
    const me = (typeof myUser !== "undefined" && myUser) ? myUser.trim().toLowerCase() : "";
    if (raw.includes("__")) {
      const parts = raw.split("__");
      return (parts[0].toLowerCase() === me) ? parts[1] : parts[0];
    }
    if (me) {
      if (raw.toLowerCase().startsWith(me + "_")) {
        return raw.substring(me.length + 1);
      }
      if (raw.toLowerCase().endsWith("_" + me)) {
        return raw.substring(0, raw.length - me.length - 1);
      }
    }
    const parts = raw.split("_");
    for (const p of parts) {
      if (p.toLowerCase() !== me) return p;
    }
    return parts[0];
  }
  if (currentRoomTitle && currentRoomTitle.startsWith("@")) {
    return currentRoomTitle.replace("@", "").trim();
  }
  return null;
}


function startAudioCall() {
  const other = getDmPartnerUsername();
  if (!other) {
    showToast("Voice calls are currently available in 1-on-1 Direct Messages.", "ℹ️");
    return;
  }
  const rtc = window.WebRTC || (typeof WebRTC !== "undefined" ? WebRTC : null);
  if (rtc && rtc.startCall) {
    rtc.startCall(other, "audio");
  } else {
    showToast("Calling module is initializing, please retry.", "⚠️");
  }
}

function startVideoCall() {
  const other = getDmPartnerUsername();
  if (!other) {
    showToast("Video calls are currently available in 1-on-1 Direct Messages.", "ℹ️");
    return;
  }
  const rtc = window.WebRTC || (typeof WebRTC !== "undefined" ? WebRTC : null);
  if (rtc && rtc.startCall) {
    rtc.startCall(other, "video");
  } else {
    showToast("Calling module is initializing, please retry.", "⚠️");
  }
}

// --- In-Chat Message Search ---
let inchatMatches = [];
let currentInchatMatchIndex = -1;

function toggleMessageSearch() {
  const bar = document.getElementById("inchatSearchBar");
  if (!bar) return;
  const isHidden = (bar.style.display === "none" || !bar.style.display);
  if (isHidden) {
    bar.style.display = "block";
    const input = document.getElementById("inchatSearchInput");
    if (input) {
      input.focus();
      input.select();
      if (input.value) runMessageSearch(input.value);
    }
  } else {
    closeMessageSearch();
  }
}

function closeMessageSearch() {
  const bar = document.getElementById("inchatSearchBar");
  if (bar) bar.style.display = "none";
  clearInchatHighlights();
}

function clearInchatHighlights() {
  inchatMatches = [];
  currentInchatMatchIndex = -1;
  const countEl = document.getElementById("inchatMatchCount");
  if (countEl) countEl.textContent = "0 of 0";

  document.querySelectorAll("#messages .msg-text-content").forEach(el => {
    if (el.dataset.rawText !== undefined) {
      el.textContent = el.dataset.rawText;
    }
  });
}

function runMessageSearch(query) {
  const q = (query || "").trim();
  clearInchatHighlights();
  if (!q) return;

  const textNodes = document.querySelectorAll("#messages .msg-text-content");
  let totalMatches = 0;
  const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQ})`, "gi");

  textNodes.forEach(el => {
    if (!el.dataset.rawText) {
      el.dataset.rawText = el.textContent;
    }
    const raw = el.dataset.rawText;
    if (regex.test(raw)) {
      regex.lastIndex = 0;
      el.innerHTML = raw.replace(regex, (m) => {
        const id = `inchatMatch_${totalMatches}`;
        totalMatches++;
        return `<mark class="inchat-highlight" id="${id}">${esc(m)}</mark>`;
      });
    }
  });

  const countEl = document.getElementById("inchatMatchCount");
  if (totalMatches === 0) {
    if (countEl) countEl.textContent = "0 of 0";
    return;
  }

  inchatMatches = Array.from(document.querySelectorAll("#messages mark.inchat-highlight"));
  currentInchatMatchIndex = inchatMatches.length - 1; // start with the most recent match
  updateInchatActiveMatch();
}

function navMessageSearch(dir) {
  if (inchatMatches.length === 0) return;
  currentInchatMatchIndex = (currentInchatMatchIndex + dir + inchatMatches.length) % inchatMatches.length;
  updateInchatActiveMatch();
}

function updateInchatActiveMatch() {
  if (inchatMatches.length === 0 || currentInchatMatchIndex < 0) return;
  inchatMatches.forEach((m, idx) => {
    m.classList.toggle("active-match", idx === currentInchatMatchIndex);
  });

  const active = inchatMatches[currentInchatMatchIndex];
  if (active) {
    active.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const countEl = document.getElementById("inchatMatchCount");
  if (countEl) {
    countEl.textContent = `${currentInchatMatchIndex + 1} of ${inchatMatches.length}`;
  }
}

function onMessageSearchKeyDown(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    if (e.shiftKey) {
      navMessageSearch(-1);
    } else {
      navMessageSearch(1);
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeMessageSearch();
  }
}

// Global keyboard shortcuts for faster navigation
window.addEventListener("keydown", (e) => {
  // Ctrl+F / Cmd+F -> In-Chat Search
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    if (typeof currentView !== "undefined" && currentView === "chat") {
      e.preventDefault();
      toggleMessageSearch();
    }
  }
  // Ctrl+K / Cmd+K -> Focus Quick Jump Search
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (typeof openPeopleSearch === "function") {
      openPeopleSearch();
    } else {
      const input = document.getElementById("sidebarSearchInput");
      if (input) { input.focus(); input.select(); }
    }
  }
  // Alt+H -> Return to Home Command Center
  if (e.altKey && e.key.toLowerCase() === "h") {
    e.preventDefault();
    if (typeof setView === "function") {
      setView("home");
    }
  }
  // Alt+Up / Alt+Down -> Cycle channels
  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    if (Array.isArray(myRooms) && myRooms.length > 0) {
      e.preventDefault();
      const currIdx = myRooms.findIndex(r => r.id === currentRoom);
      let nextIdx = (e.key === "ArrowUp") ? currIdx - 1 : currIdx + 1;
      if (nextIdx < 0) nextIdx = myRooms.length - 1;
      if (nextIdx >= myRooms.length) nextIdx = 0;
      const targetRoom = myRooms[nextIdx];
      if (targetRoom && typeof openRoom === "function") {
        openRoom(targetRoom.id, targetRoom.name, targetRoom.is_dm);
      }
    }
  }
});



