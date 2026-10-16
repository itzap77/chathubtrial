function playNotifySound(isMention=false){
  try {
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    if (isMention) {
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.12);
    } else {
      osc.frequency.setValueAtTime(540, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.08);
    }
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
  } catch(e) {}
}

function avColor(s){let h=0;for(let i=0;i<s.length;i++)h=s.charCodeAt(i)+((h<<5)-h);return AV_COLORS[Math.abs(h)%AV_COLORS.length]}

function initials(s){return (s||"?")[0]?.toUpperCase()||"?"}

window.userAvatarColors = window.userAvatarColors || {};

function renderAvatar(el,name,presenceClass="pres-grey",customColor=null){
  if(!el) return;
  el.textContent=initials(name);
  if(customColor) {
    el.style.background = customColor;
  } else if(name && window.userAvatarColors && window.userAvatarColors[name.toLowerCase()]) {
    el.style.background = window.userAvatarColors[name.toLowerCase()];
  } else {
    el.style.background = avColor(name || "?");
  }
  el.style.color = "#ffffff";
  el.classList.remove("pres-green","pres-orange","pres-grey");
  el.classList.add(presenceClass);
}

function togglePasswordVisibility(inputId, btn){
  const input = document.getElementById(inputId);
  if(!input) return;
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  if(btn) btn.classList.toggle("showing", !showing);
}

function esc(s){const d=document.createElement("div");d.innerText=s??"";return d.innerHTML}

function apiError(d, fallback){
  const det = d && d.detail;
  if(typeof det === "string" && det) return det;
  if(Array.isArray(det)) return det.map(x => x.msg || x.message || JSON.stringify(x)).join("; ");
  if(det && typeof det === "object") return det.msg || det.message || JSON.stringify(det);
  return fallback;
}

function fmtTime(ts){return ts?new Date(ts*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):""}

function showToast(text, icon="ℹ️"){
  const c = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span>${icon}</span><span>${esc(text)}</span>`;
  c.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transform="translateY(8px)"; setTimeout(()=>el.remove(), 200); }, 3200);
}

function showConfirmCard({ icon="⚠️", title="Are you sure?", text="", onConfirm }){
  document.getElementById("confirmCardIcon").textContent = icon;
  document.getElementById("confirmCardTitle").textContent = title;
  document.getElementById("confirmCardText").textContent = text;
  const okBtn = document.getElementById("confirmCardOkBtn");
  okBtn.onclick = ()=>{
    closeOverlay("confirmOverlay");
    if(onConfirm) onConfirm();
  };
  openOverlay("confirmOverlay");
}

