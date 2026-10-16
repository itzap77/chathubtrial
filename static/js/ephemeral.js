function setEphTab(m){
  document.getElementById("ephTabCreate").classList.toggle("active", m === "create");
  document.getElementById("ephTabJoin").classList.toggle("active", m === "join");
  document.getElementById("ephCreateFields").style.display = m === "create" ? "block" : "none";
  document.getElementById("ephJoinFields").style.display = m === "join" ? "block" : "none";
}

function toggleEphLimitBox(){
  const type = document.getElementById("ephType").value;
  document.getElementById("ephLimitWrap").style.display = type === "group" ? "block" : "none";
}

async function createDisposableRoom(){
  const type = document.getElementById("ephType").value;
  let limit = 2;
  if (type === "group") {
    const rawLimit = parseInt(document.getElementById("ephLimit").value, 10);
    limit = Math.max(2, Math.min(50, isNaN(rawLimit) ? 5 : rawLimit));
    document.getElementById("ephLimit").value = limit;
  }

  const res = await fetch("/api/ephemeral/create", {
    method: "POST",
    body: new URLSearchParams({ room_type: type, max_limit: limit })
  });
  const d = await res.json();
  if(!res.ok) return showToast(d.detail || "Room creation failed", "❌");
  
  closeOverlay("ephemeralOverlay");
  closeOverlay("authOverlay");
  
  const roomTitle = type === "dm" ? "⚡ 1-to-1 Disposable DM" : "⚡ Disposable Group";
  
  if (!authToken) {
    isGuestUser = true;
    myUser = d.assigned_alias;
    applyGuestUIRestrictions();
  }
  
  pinEphemeralRoom(d.room_id, roomTitle, d.assigned_alias);
  openRoom(d.room_id, roomTitle, false);
  showToast(`Room Active! Your alias: ${d.assigned_alias}`, "⚡");
}

async function joinDisposableRoom(){
  const code = document.getElementById("ephJoinCode").value.trim().toLowerCase();
  if(!code) return showToast("Room code required", "⚠️");
  
  const res = await fetch("/api/ephemeral/verify", {
    method: "POST",
    body: new URLSearchParams({ room_id: code })
  });
  const d = await res.json();
  if(!res.ok) return showToast(d.detail || "Unable to join room", "❌");
  
  closeOverlay("ephemeralOverlay");
  closeOverlay("authOverlay");
  
  const roomTitle = "⚡ Disposable Space";

  if (!authToken) {
    isGuestUser = true;
    myUser = d.assigned_alias;
    applyGuestUIRestrictions();
  }
  
  pinEphemeralRoom(d.room_id, roomTitle, d.assigned_alias);
  openRoom(d.room_id, roomTitle, false);
  showToast(`Connected as: ${d.assigned_alias}`, "⚡");
}

function pinEphemeralRoom(id, title, alias){
  const existing = myPinnedEphemerals.find(r => r.id === id);
  if (!existing) {
    myPinnedEphemerals.push({ id, title, alias });
  }
  renderRoomLists();
}

function unpinEphemeralRoom(id, e){
  if(e) e.stopPropagation();
  myPinnedEphemerals = myPinnedEphemerals.filter(r => r.id !== id);
  renderRoomLists();
  
  if (currentRoom === id) {
    if (ws) ws.close();
    if (!isGuestUser) {
      openRoom("public", "Public Group", false);
    } else {
      location.reload();
    }
  }
}

