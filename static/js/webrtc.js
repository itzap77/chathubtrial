// ==========================================================================
// CHATHUB WEBRTC AUDIO & VIDEO CALLING ENGINE (PRODUCTION GRADE)
// Features: Peer-to-Peer WebRTC, WebSocket signaling, STUN fallbacks,
// Hardware-resilient media acquisition (audio/video virtual fallbacks for
// missing hardware/locked webcams), Full candidate queuing & flushing,
// Dual-tone synthesizer ringtones, Call timer, Mic/Cam/Screen controls,
// Picture-in-Picture (PiP) mini-bar, Active speaker glow detection,
// Fullscreen mode, Latency / Quality meter, and Chat-integrated call logs.
// ==========================================================================

const WebRTC = (function() {
  let peerConnection = null;
  let localStream = null;
  let remoteStream = null;
  let currentCallTarget = null;
  let callMode = "video"; // "video" or "audio"
  let isScreenSharing = false;
  let isPip = false;
  let isFullscreen = false;
  let candidateQueue = [];
  let ringtoneInterval = null;
  let callTimerInterval = null;
  let callStartTime = 0;
  let callLogged = false;
  let statsInterval = null;

  // Inbuilt Hardware Device Selections
  let selectedAudioInputId = null;
  let selectedVideoInputId = null;
  let selectedAudioOutputId = null;

  // Audio Analysers for Active Speaker Glow
  let localAnalyser = null;
  let remoteAnalyser = null;
  let speakingPollInterval = null;

  const RTC_CONFIG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" }
    ]
  };

  function getAudioContext() {
    try {
      if (!window.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          window.audioCtx = new AudioContextClass();
        }
      }
      if (window.audioCtx && window.audioCtx.state === "suspended") {
        window.audioCtx.resume().catch(() => {});
      }
      return window.audioCtx;
    } catch (e) {
      return null;
    }
  }

  function getSocket() {
    if (typeof ws !== "undefined" && ws && ws.readyState === 1) return ws;
    if (window.ws && window.ws.readyState === 1) return window.ws;
    if (window.activeWs && window.activeWs.readyState === 1) return window.activeWs;
    return null;
  }

  function sendSignal(obj) {
    const socket = getSocket();
    if (socket && socket.readyState === 1) {
      console.log("[WebRTC] Sending signal:", obj.action, "to", obj.target);
      socket.send(JSON.stringify({
        type: "webrtc_signal",
        ...obj
      }));
    } else {
      console.warn("[WebRTC] WebSocket is not connected or not ready. Signal buffered.");
      setTimeout(() => {
        const retrySocket = getSocket();
        if (retrySocket && retrySocket.readyState === 1) {
          retrySocket.send(JSON.stringify({ type: "webrtc_signal", ...obj }));
        }
      }, 500);
    }
  }

  // Dual-tone synthesizer for ringtones
  function playRingtone(isIncoming = false) {
    stopRingtone();
    const ctx = getAudioContext();
    if (!ctx) return;

    const intervalMs = isIncoming ? 2200 : 3000;
    const playChime = () => {
      try {
        if (ctx.state === "suspended") ctx.resume();
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        // Musical chord
        osc1.frequency.setValueAtTime(isIncoming ? 523.25 : 440, now); // C5 or A4
        osc2.frequency.setValueAtTime(isIncoming ? 659.25 : 554.37, now); // E5 or C#5

        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.0);
        osc2.stop(now + 1.0);
      } catch (e) {
        console.warn("[WebRTC] Ringtone audio error:", e);
      }
    };

    playChime();
    ringtoneInterval = setInterval(playChime, intervalMs);
  }

  function stopRingtone() {
    if (ringtoneInterval) {
      clearInterval(ringtoneInterval);
      ringtoneInterval = null;
    }
  }

  function formatTime(seconds) {
    const m = String(Math.floor(seconds / 60)).padStart(2, "0");
    const s = String(seconds % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function startCallTimer() {
    stopCallTimer();
    callStartTime = Date.now();
    callTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
      updateCallStatus(`Live • ${formatTime(elapsed)}`);
    }, 1000);
    updateCallStatus("Live • 00:00");
    startQualityMonitor();
  }

  function stopCallTimer() {
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
    stopQualityMonitor();
  }

  // Measure WebRTC Round Trip Time & Connection Quality
  function startQualityMonitor() {
    stopQualityMonitor();
    const qBadge = document.getElementById("callQualityBadge");
    if (qBadge) qBadge.style.display = "inline-flex";

    statsInterval = setInterval(async () => {
      if (!peerConnection) return;
      try {
        const stats = await peerConnection.getStats();
        let rttMs = null;
        stats.forEach(report => {
          if (report.type === "candidate-pair" && report.selected) {
            if (report.currentRoundTripTime !== undefined) {
              rttMs = Math.round(report.currentRoundTripTime * 1000);
            }
          }
        });
        if (qBadge) {
          if (rttMs !== null) {
            qBadge.textContent = `🟢 HD P2P • ${rttMs}ms`;
          } else {
            qBadge.textContent = "🟢 HD P2P";
          }
        }
      } catch (e) {}
    }, 2500);
  }

  function stopQualityMonitor() {
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }
    const qBadge = document.getElementById("callQualityBadge");
    if (qBadge) qBadge.style.display = "none";
  }

  // Active Speaker Detection with Web Audio API AnalyserNode
  function setupAudioMeters(local, remote) {
    teardownAudioMeters();
    const ctx = getAudioContext();
    if (!ctx) return;

    try {
      if (local && local.getAudioTracks().length > 0) {
        const src = ctx.createMediaStreamSource(local);
        localAnalyser = ctx.createAnalyser();
        localAnalyser.fftSize = 64;
        src.connect(localAnalyser);
      }
      if (remote && remote.getAudioTracks().length > 0) {
        const src = ctx.createMediaStreamSource(remote);
        remoteAnalyser = ctx.createAnalyser();
        remoteAnalyser.fftSize = 64;
        src.connect(remoteAnalyser);
      }

      const dataBuf = new Uint8Array(32);
      speakingPollInterval = setInterval(() => {
        // Local speaker volume
        if (localAnalyser) {
          localAnalyser.getByteFrequencyData(dataBuf);
          let sum = 0;
          for (let i = 0; i < dataBuf.length; i++) sum += dataBuf[i];
          const avg = sum / dataBuf.length;
          const localWrap = document.getElementById("localVideoWrap");
          if (localWrap) localWrap.classList.toggle("speaking-glow", avg > 16);
        }

        // Remote speaker volume
        if (remoteAnalyser) {
          remoteAnalyser.getByteFrequencyData(dataBuf);
          let sum = 0;
          for (let i = 0; i < dataBuf.length; i++) sum += dataBuf[i];
          const avg = sum / dataBuf.length;
          const remoteVid = document.getElementById("remoteVideo");
          const audioAv = document.getElementById("callAudioAvatar");
          if (remoteVid) remoteVid.classList.toggle("speaking-glow", avg > 16);
          if (audioAv) audioAv.classList.toggle("speaking-glow", avg > 16);
        }
      }, 120);
    } catch (e) {
      console.warn("[WebRTC] Audio meters setup error:", e);
    }
  }

  function teardownAudioMeters() {
    if (speakingPollInterval) {
      clearInterval(speakingPollInterval);
      speakingPollInterval = null;
    }
    localAnalyser = null;
    remoteAnalyser = null;
    const localWrap = document.getElementById("localVideoWrap");
    const remoteVid = document.getElementById("remoteVideo");
    const audioAv = document.getElementById("callAudioAvatar");
    if (localWrap) localWrap.classList.remove("speaking-glow");
    if (remoteVid) remoteVid.classList.remove("speaking-glow");
    if (audioAv) audioAv.classList.remove("speaking-glow");
  }

  // Create synthetic fallback stream for headless/locked hardware testing
  function createFallbackMediaStream(type, username = "User") {
    const tracks = [];
    
    // 1. Silent synthetic audio track
    try {
      const ctx = getAudioContext();
      if (ctx) {
        const osc = ctx.createOscillator();
        const dst = ctx.createMediaStreamDestination();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(dst);
        osc.start();
        const aTrack = dst.stream.getAudioTracks()[0];
        if (aTrack) tracks.push(aTrack);
      }
    } catch (e) {
      console.warn("[WebRTC] Fallback audio track creation failed:", e);
    }

    // 2. Virtual canvas video track if video mode
    if (type === "video") {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx2d = canvas.getContext("2d");
        
        const drawPlaceholder = () => {
          ctx2d.fillStyle = "#0f172a";
          ctx2d.fillRect(0, 0, 640, 480);

          const grad = ctx2d.createRadialGradient(320, 220, 10, 320, 220, 130);
          grad.addColorStop(0, "rgba(99, 102, 241, 0.9)");
          grad.addColorStop(1, "rgba(79, 70, 229, 0.15)");
          ctx2d.fillStyle = grad;
          ctx2d.beginPath();
          ctx2d.arc(320, 220, 95, 0, Math.PI * 2);
          ctx2d.fill();

          ctx2d.fillStyle = "#ffffff";
          ctx2d.font = "bold 64px sans-serif";
          ctx2d.textAlign = "center";
          ctx2d.textBaseline = "middle";
          const displayInitial = (username || "U").substring(0, 2).toUpperCase();
          ctx2d.fillText(displayInitial, 320, 220);

          ctx2d.fillStyle = "#94a3b8";
          ctx2d.font = "18px monospace";
          ctx2d.fillText("Virtual Camera Feed", 320, 350);
        };

        drawPlaceholder();
        const stream = canvas.captureStream(10);
        const vTrack = stream.getVideoTracks()[0];
        if (vTrack) tracks.push(vTrack);
      } catch (e) {
        console.warn("[WebRTC] Fallback video track creation failed:", e);
      }
    }

    return new MediaStream(tracks);
  }

  // Robust media acquisition that never crashes
  async function acquireMediaStream(type, username) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn("[WebRTC] navigator.mediaDevices not supported on this origin, using virtual stream.");
      showToast("Using virtual audio/video (localhost or HTTPS recommended)", "ℹ️");
      return createFallbackMediaStream(type, username);
    }

    const audioConstraint = selectedAudioInputId
      ? { deviceId: { exact: selectedAudioInputId } }
      : true;
    const videoConstraint = selectedVideoInputId
      ? { deviceId: { exact: selectedVideoInputId }, width: { ideal: 640 }, height: { ideal: 480 } }
      : { width: { ideal: 640 }, height: { ideal: 480 } };

    if (type === "video") {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: videoConstraint
        });
      } catch (videoErr) {
        console.warn("[WebRTC] Full video capture failed, trying audio hardware fallback:", videoErr);
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false });
          const fallback = createFallbackMediaStream("video", username);
          fallback.getVideoTracks().forEach(t => audioOnly.addTrack(t));
          showToast("Camera busy. Virtual video active.", "ℹ️");
          return audioOnly;
        } catch (audioErr) {
          console.warn("[WebRTC] Audio capture failed too, using complete virtual stream:", audioErr);
          showToast("Media hardware unavailable. Virtual stream active.", "ℹ️");
          return createFallbackMediaStream(type, username);
        }
      }
    } else {
      // Audio call
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false });
      } catch (audioErr) {
        console.warn("[WebRTC] Audio capture failed, using virtual stream:", audioErr);
        showToast("Microphone unavailable. Virtual stream active.", "ℹ️");
        return createFallbackMediaStream(type, username);
      }
    }
  }

  // Post permanent Call Summary Card directly into DM Chat Stream
  function postCallLog(target, type, status, durationStr = null) {
    if (callLogged || !target) return;
    callLogged = true;

    const socket = getSocket();
    if (!socket || socket.readyState !== 1) return;

    try {
      const payload = {
        type: "chat",
        text: "call_log:" + JSON.stringify({
          type: type || callMode,
          status: status,
          duration: durationStr,
          partner: target,
          timestamp: Date.now()
        })
      };
      socket.send(JSON.stringify(payload));
    } catch (e) {
      console.warn("[WebRTC] postCallLog error:", e);
    }
  }

  // 1. Start an Outgoing Call
  async function startCall(targetUsername, type = "video") {
    if (!targetUsername) {
      showToast("Select a contact to call.", "⚠️");
      return;
    }
    const myName = (typeof myUser !== "undefined" && myUser) ? myUser.trim() : "";
    if (myName && targetUsername.toLowerCase() === myName.toLowerCase()) {
      showToast("Cannot place a call to yourself.", "⚠️");
      return;
    }
    if (peerConnection) {
      showToast("Another call is currently active.", "⚠️");
      return;
    }

    console.log(`[WebRTC] Starting ${type} call to @${targetUsername}`);
    currentCallTarget = targetUsername;
    callMode = type;
    candidateQueue = [];
    callLogged = false;

    showCallModal(targetUsername, "Requesting media permissions…", type);

    try {
      localStream = await acquireMediaStream(type, myName);
      attachLocalMedia(localStream);
      createPeerConnection();

      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      sendSignal({
        action: "call",
        target: targetUsername,
        call_type: type,
        signal: offer
      });

      updateCallStatus(`Ringing @${targetUsername}…`);
      playRingtone(false);
    } catch (e) {
      console.error("[WebRTC] startCall unexpected error:", e);
      stopRingtone();
      showToast("Call initiation failed: " + (e.message || "Unknown error"), "❌");
      endCall(false);
    }
  }

  // 2. Handle Incoming Signal from WebSocket
  async function handleSignal(payload) {
    if (!payload || !payload.action) return;
    const action = payload.action;
    const sender = payload.sender;
    const target = payload.target;
    const myName = (typeof myUser !== "undefined" && myUser) ? myUser.trim().toLowerCase() : "";

    // Ignore self-reflected signals
    if (sender && sender.toLowerCase() === myName) return;

    // Ignore signals explicitly addressed to someone else
    if (target && target.toLowerCase() !== myName) return;

    console.log(`[WebRTC] Received signal [${action}] from @${sender}:`, payload);

    if (action === "call") {
      if (peerConnection) {
        console.warn("[WebRTC] Already in a call, declining incoming call from", sender);
        sendSignal({ action: "decline", target: sender, reason: "busy" });
        return;
      }
      currentCallTarget = sender;
      callMode = payload.call_type || "video";
      candidateQueue = [];
      callLogged = false;
      showIncomingCallBanner(sender, callMode, payload.signal);
      playRingtone(true);

      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        new Notification(`Incoming ${callMode === "video" ? "Video" : "Voice"} Call`, {
          body: `@${sender} is calling you on ChatHub`,
          icon: "/favicon.ico"
        });
      }
    } 
    else if (action === "accept") {
      stopRingtone();
      hideIncomingCallBanner();
      if (peerConnection && payload.signal) {
        try {
          console.log("[WebRTC] Setting remote description (answer)...");
          await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.signal));
          
          // Flush queued candidates
          console.log(`[WebRTC] Flushing ${candidateQueue.length} queued ICE candidates`);
          while (candidateQueue.length > 0) {
            const cand = candidateQueue.shift();
            try {
              await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn("[WebRTC] addIceCandidate error:", e);
            }
          }
          startCallTimer();
        } catch (e) {
          console.error("[WebRTC] setRemoteDescription (answer) failed:", e);
        }
      }
    } 
    else if (action === "candidate") {
      if (payload.signal) {
        if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(payload.signal));
          } catch (e) {
            console.warn("[WebRTC] Failed to add incoming ICE candidate:", e);
          }
        } else {
          candidateQueue.push(payload.signal);
        }
      }
    } 
    else if (action === "decline") {
      stopRingtone();
      hideIncomingCallBanner();
      showToast(`@${sender} declined the call.`, "📞");
      postCallLog(sender, callMode, "declined");
      endCall(false);
    } 
    else if (action === "end") {
      stopRingtone();
      hideIncomingCallBanner();
      showToast(`Call ended by @${sender}.`, "📞");
      endCall(false);
    }
    else if (action === "offline") {
      stopRingtone();
      hideIncomingCallBanner();
      showToast(`@${sender} is currently offline.`, "⚠️");
      postCallLog(sender, callMode, "missed");
      endCall(false);
    }
    else if (action === "renegotiate") {
      console.log("[WebRTC] Received renegotiation offer from @", sender);
      if (peerConnection && payload.signal) {
        try {
          if (payload.call_type === "video" && callMode !== "video") {
            setCallMode("video");
            showToast(`@${sender} activated video.`, "📹");
          }
          await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.signal));
          
          while (candidateQueue.length > 0) {
            const cand = candidateQueue.shift();
            try {
              await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn("[WebRTC] addIceCandidate error during renegotiate:", e);
            }
          }

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          sendSignal({
            action: "renegotiate_answer",
            target: sender,
            call_type: "video",
            signal: answer
          });
        } catch (e) {
          console.error("[WebRTC] renegotiate handling failed:", e);
        }
      }
    }
    else if (action === "renegotiate_answer") {
      console.log("[WebRTC] Received renegotiation answer from @", sender);
      if (peerConnection && payload.signal) {
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.signal));
          while (candidateQueue.length > 0) {
            const cand = candidateQueue.shift();
            try {
              await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn("[WebRTC] addIceCandidate error during renegotiate_answer:", e);
            }
          }
        } catch (e) {
          console.error("[WebRTC] setRemoteDescription (renegotiate_answer) failed:", e);
        }
      }
    }
    else if (action === "upgrade_request") {
      console.log("[WebRTC] Received upgrade request from @", sender, payload.media_type);
      pendingUpgradeRequest = { sender, media_type: payload.media_type || "video" };
      showUpgradePrompt(sender, payload.media_type || "video");
    }
    else if (action === "upgrade_response") {
      console.log("[WebRTC] Received upgrade response from @", sender, payload.accepted);
      if (payload.accepted) {
        showToast(`@${sender} accepted the ${payload.media_type || "video"} request!`, "📹");
        if (payload.media_type === "screen") {
          startScreenShareStream();
        } else {
          executeUpgradeToVideo();
        }
      } else {
        showToast(`@${sender} declined the ${payload.media_type || "video"} request.`, "ℹ️");
        updateCallStatus("Live");
      }
    }
  }

  // 3. Accept Incoming Call
  async function acceptCall(sender, type, offerSignal) {
    console.log(`[WebRTC] Accepting ${type} call from @${sender}`);
    stopRingtone();
    hideIncomingCallBanner();
    currentCallTarget = sender;
    callMode = type;
    const myName = (typeof myUser !== "undefined" && myUser) ? myUser.trim() : "";

    showCallModal(sender, "Connecting P2P stream…", type);

    try {
      localStream = await acquireMediaStream(type, myName);
      attachLocalMedia(localStream);
      createPeerConnection();

      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

      console.log("[WebRTC] Setting remote description (offer)...");
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offerSignal));
      
      // Flush queued candidates
      console.log(`[WebRTC] Callee flushing ${candidateQueue.length} queued ICE candidates`);
      while (candidateQueue.length > 0) {
        const cand = candidateQueue.shift();
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn("[WebRTC] Callee addIceCandidate error:", e);
        }
      }

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      sendSignal({
        action: "accept",
        target: sender,
        signal: answer
      });

      startCallTimer();
    } catch (e) {
      console.error("[WebRTC] acceptCall error:", e);
      showToast("Call connection failed: " + (e.message || "Unknown error"), "❌");
      endCall(true);
    }
  }

  function declineCall(sender) {
    stopRingtone();
    hideIncomingCallBanner();
    sendSignal({ action: "decline", target: sender });
    postCallLog(sender, callMode, "declined");
    currentCallTarget = null;
  }

  // 4. Create RTCPeerConnection Instance
  function createPeerConnection() {
    peerConnection = new RTCPeerConnection(RTC_CONFIG);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && currentCallTarget) {
        sendSignal({
          action: "candidate",
          target: currentCallTarget,
          signal: event.candidate
        });
      }
    };

    peerConnection.ontrack = (event) => {
      console.log("[WebRTC] ontrack received:", event.track.kind, event.streams);
      const remoteVideo = document.getElementById("remoteVideo");
      if (!remoteVideo) return;
      if (event.streams && event.streams[0]) {
        remoteStream = event.streams[0];
        remoteVideo.srcObject = remoteStream;
      } else {
        if (!remoteStream) {
          remoteStream = new MediaStream();
        }
        remoteStream.addTrack(event.track);
        remoteVideo.srcObject = remoteStream;
      }

      if (event.track.kind === "video") {
        setCallMode("video");
      }

      if (selectedAudioOutputId && typeof remoteVideo.setSinkId === "function") {
        remoteVideo.setSinkId(selectedAudioOutputId).catch(() => {});
      }

      remoteVideo.play().catch(e => console.warn("[WebRTC] remoteVideo autoplay:", e));

      // Hook up voice activity visualizers
      setupAudioMeters(localStream, remoteStream);
    };

    peerConnection.onconnectionstatechange = () => {
      if (!peerConnection) return;
      const state = peerConnection.connectionState;
      console.log("[WebRTC] connectionState change:", state);
      if (state === "connected") {
        stopRingtone();
        startCallTimer();
      } else if (state === "disconnected" || state === "failed" || state === "closed") {
        endCall(false);
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      if (!peerConnection) return;
      const iceState = peerConnection.iceConnectionState;
      console.log("[WebRTC] iceConnectionState change:", iceState);
      if (iceState === "connected" || iceState === "completed") {
        stopRingtone();
        startCallTimer();
      } else if (iceState === "failed") {
        console.warn("[WebRTC] ICE Connection failed.");
        endCall(false);
      }
    };
  }

  // 5. End Call & Cleanup
  function endCall(notifyRemote = true) {
    console.log("[WebRTC] Ending call. notifyRemote:", notifyRemote);
    stopRingtone();
    teardownAudioMeters();

    // Calculate call duration for chat log card
    let elapsedSecs = 0;
    if (callStartTime > 0) {
      elapsedSecs = Math.floor((Date.now() - callStartTime) / 1000);
    }
    stopCallTimer();

    if (currentCallTarget) {
      if (elapsedSecs > 0) {
        postCallLog(currentCallTarget, callMode, "completed", formatTime(elapsedSecs));
      } else if (notifyRemote) {
        postCallLog(currentCallTarget, callMode, "missed");
      }
    }

    if (notifyRemote && currentCallTarget) {
      sendSignal({ action: "end", target: currentCallTarget });
    }

    if (localStream) {
      localStream.getTracks().forEach(t => {
        try { t.stop(); } catch(e){}
      });
      localStream = null;
    }
    remoteStream = null;

    if (peerConnection) {
      try { peerConnection.close(); } catch(e){}
      peerConnection = null;
    }

    const localVideo = document.getElementById("localVideo");
    const remoteVideo = document.getElementById("remoteVideo");
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;

    hideCallModal();
    hideIncomingCallBanner();
    hideUpgradePrompt();
    const devPanel = document.getElementById("callDeviceSettingsPanel");
    if (devPanel) devPanel.style.display = "none";
    currentCallTarget = null;
    isScreenSharing = false;
    isPip = false;
    isFullscreen = false;
    callStartTime = 0;
    candidateQueue = [];

    // Reset control buttons state
    const muteBtn = document.getElementById("callBtnMute");
    const camBtn = document.getElementById("callBtnCam");
    const screenBtn = document.getElementById("callBtnScreen");
    if (muteBtn) muteBtn.classList.remove("call-ctrl-off");
    if (camBtn) camBtn.classList.remove("call-ctrl-off");
    if (screenBtn) screenBtn.classList.remove("call-ctrl-active");
  }

  // Controls: Mute Audio, Toggle Video, Screenshare
  function toggleMute() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const btn = document.getElementById("callBtnMute");
      if (btn) btn.classList.toggle("call-ctrl-off", !audioTrack.enabled);
      showToast(audioTrack.enabled ? "Microphone unmuted" : "Microphone muted", "🎙️");
    }
  }

  function toggleVideo() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      const btn = document.getElementById("callBtnCam");
      if (btn) btn.classList.toggle("call-ctrl-off", !videoTrack.enabled);
      showToast(videoTrack.enabled ? "Camera enabled" : "Camera paused", "📷");
    }
  }

  let pendingUpgradeRequest = null;

  function showUpgradePrompt(sender, mediaType) {
    const promptCard = document.getElementById("callUpgradePrompt");
    if (!promptCard) return;

    const titleEl = document.getElementById("upgradePromptTitle");
    const subEl = document.getElementById("upgradePromptSub");
    const iconEl = document.getElementById("upgradePromptIcon");

    const isScreen = mediaType === "screen";
    if (titleEl) titleEl.textContent = isScreen ? "Screen Share Request" : "Video Call Request";
    if (subEl) subEl.textContent = isScreen ? `@${sender} wants to share their screen` : `@${sender} wants to switch to Video`;
    if (iconEl) iconEl.textContent = isScreen ? "🖥️" : "📹";

    promptCard.style.display = "flex";
    playNotificationTone();
  }

  function hideUpgradePrompt() {
    const promptCard = document.getElementById("callUpgradePrompt");
    if (promptCard) promptCard.style.display = "none";
  }

  async function respondUpgradeRequest(accepted) {
    hideUpgradePrompt();
    if (!pendingUpgradeRequest || !currentCallTarget) return;

    const { sender, media_type } = pendingUpgradeRequest;
    pendingUpgradeRequest = null;

    sendSignal({
      action: "upgrade_response",
      accepted: !!accepted,
      media_type: media_type || "video",
      target: sender
    });

    if (accepted) {
      showToast(`Accepted ${media_type || "video"} request`, "✓");
      setCallMode("video");
      if (media_type === "video") {
        await executeUpgradeToVideo();
      }
    } else {
      showToast(`Declined ${media_type || "video"} request`, "ℹ️");
    }
  }

  function playNotificationTone() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.1);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {}
  }

  async function toggleScreenShare() {
    if (!peerConnection || !navigator.mediaDevices.getDisplayMedia) {
      showToast("Screen sharing not supported on this browser/origin.", "⚠️");
      return;
    }

    if (isScreenSharing) {
      stopScreenShare();
      return;
    }

    // In voice call, ask the peer first so it is rejectable & acceptable
    if (callMode === "audio") {
      showToast(`Requesting screen share with @${currentCallTarget}…`, "🖥️");
      sendSignal({
        action: "upgrade_request",
        media_type: "screen",
        target: currentCallTarget
      });
      updateCallStatus("Requested screen share…");
      return;
    }

    await startScreenShareStream();
  }

  async function startScreenShareStream() {
    if (!peerConnection || !navigator.mediaDevices.getDisplayMedia) return;
    try {
      const localVideo = document.getElementById("localVideo");
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === "video");

      if (sender) {
        await sender.replaceTrack(screenTrack);
      } else {
        peerConnection.addTrack(screenTrack, screenStream);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignal({
          action: "renegotiate",
          target: currentCallTarget,
          call_type: "video",
          signal: offer
        });
      }

      setCallMode("video");

      if (localVideo) {
        localVideo.srcObject = screenStream;
        localVideo.classList.add("screenshare-active");
      }

      screenTrack.onended = () => {
        stopScreenShare();
      };

      isScreenSharing = true;
      const btn = document.getElementById("callBtnScreen");
      if (btn) btn.classList.add("call-ctrl-active");
      showToast("Screen sharing active", "🖥️");
    } catch (e) {
      console.warn("[WebRTC] Screen share cancelled:", e);
    }
  }

  function stopScreenShare() {
    if (!peerConnection) return;
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === "video");
    const videoTrack = localStream ? localStream.getVideoTracks()[0] : null;

    if (sender && videoTrack) {
      sender.replaceTrack(videoTrack);
    }
    const localVideo = document.getElementById("localVideo");
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.classList.remove("screenshare-active");
    }

    isScreenSharing = false;
    const btn = document.getElementById("callBtnScreen");
    if (btn) btn.classList.remove("call-ctrl-active");
  }

  // Request or enable video camera mid-call
  async function requestOrEnableVideo() {
    if (!peerConnection) {
      showToast("No active call.", "⚠️");
      return;
    }
    if (callMode === "video") {
      toggleVideo();
      return;
    }

    // In a voice call, request the upgrade from peer so they can accept or decline
    showToast(`Requesting video call with @${currentCallTarget}…`, "📹");
    sendSignal({
      action: "upgrade_request",
      media_type: "video",
      target: currentCallTarget
    });
    updateCallStatus("Requested video…");
  }

  // Upgrades an audio call into a full video call with track addition and WebRTC renegotiation
  async function executeUpgradeToVideo() {
    if (!peerConnection) return;
    const myName = (typeof myUser !== "undefined" && myUser) ? myUser.trim() : "";
    showToast("Starting camera and upgrading to Video Call…", "📹");

    try {
      let vTrack = null;
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const camStream = await navigator.mediaDevices.getUserMedia({
            video: selectedVideoInputId
              ? { deviceId: { exact: selectedVideoInputId }, width: { ideal: 640 }, height: { ideal: 480 } }
              : { width: { ideal: 640 }, height: { ideal: 480 } }
          });
          vTrack = camStream.getVideoTracks()[0];
        } catch (camErr) {
          console.warn("[WebRTC] Physical camera capture failed, using virtual video:", camErr);
          const fallback = createFallbackMediaStream("video", myName);
          vTrack = fallback.getVideoTracks()[0];
        }
      } else {
        const fallback = createFallbackMediaStream("video", myName);
        vTrack = fallback.getVideoTracks()[0];
      }

      if (!vTrack) {
        showToast("Could not access video source.", "⚠️");
        return;
      }

      if (!localStream) {
        localStream = new MediaStream();
      }
      localStream.addTrack(vTrack);

      const localVideo = document.getElementById("localVideo");
      if (localVideo) {
        localVideo.srcObject = localStream;
      }

      const existingSender = peerConnection.getSenders().find(s => s.track && s.track.kind === "video");
      if (existingSender) {
        await existingSender.replaceTrack(vTrack);
      } else {
        peerConnection.addTrack(vTrack, localStream);
      }

      setCallMode("video");

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      sendSignal({
        action: "renegotiate",
        target: currentCallTarget,
        call_type: "video",
        signal: offer
      });

      showToast("Upgraded to Video Call", "📹");
      enumerateDevices();
    } catch (e) {
      console.error("[WebRTC] executeUpgradeToVideo failed:", e);
      showToast("Failed to switch to video: " + (e.message || "Unknown error"), "❌");
    }
  }

  async function upgradeToVideo() {
    await executeUpgradeToVideo();
  }

  // Inbuilt Hardware Enumeration
  async function enumerateDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const micSelect = document.getElementById("callSelectMic");
      const camSelect = document.getElementById("callSelectCam");
      const speakerSelect = document.getElementById("callSelectSpeaker");

      if (micSelect) {
        const audioInputs = devices.filter(d => d.kind === "audioinput");
        micSelect.innerHTML = audioInputs.length === 0
          ? '<option value="">Default Microphone</option>'
          : audioInputs.map((d, i) => `<option value="${d.deviceId}">${d.label || `Microphone ${i + 1}`}</option>`).join("");
        if (selectedAudioInputId) micSelect.value = selectedAudioInputId;
      }

      if (camSelect) {
        const videoInputs = devices.filter(d => d.kind === "videoinput");
        camSelect.innerHTML = videoInputs.length === 0
          ? '<option value="">Default Camera</option>'
          : videoInputs.map((d, i) => `<option value="${d.deviceId}">${d.label || `Camera ${i + 1}`}</option>`).join("");
        if (selectedVideoInputId) camSelect.value = selectedVideoInputId;
      }

      if (speakerSelect) {
        const audioOutputs = devices.filter(d => d.kind === "audiooutput");
        speakerSelect.innerHTML = audioOutputs.length === 0
          ? '<option value="">Default Speaker / Headphones</option>'
          : audioOutputs.map((d, i) => `<option value="${d.deviceId}">${d.label || `Speaker ${i + 1}`}</option>`).join("");
        if (selectedAudioOutputId) speakerSelect.value = selectedAudioOutputId;
      }
    } catch (e) {
      console.warn("[WebRTC] enumerateDevices failed:", e);
    }
  }

  // Switch Audio Input (Microphone) dynamically during call
  async function switchAudioInput(deviceId) {
    selectedAudioInputId = deviceId;
    if (!peerConnection || !localStream) {
      showToast("Microphone preference saved", "🎙️");
      return;
    }
    try {
      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false
      };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;

      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === "audio");
      if (sender) {
        await sender.replaceTrack(newTrack);
      }

      const oldTrack = localStream.getAudioTracks()[0];
      if (oldTrack) {
        localStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      localStream.addTrack(newTrack);

      setupAudioMeters(localStream, remoteStream);
      showToast(`Microphone active: ${newTrack.label || "Selected mic"}`, "🎙️");
    } catch (e) {
      console.error("[WebRTC] switchAudioInput failed:", e);
      showToast("Could not switch microphone: " + (e.message || "Unknown"), "⚠️");
    }
  }

  // Switch Video Input (Camera) dynamically during call
  async function switchVideoInput(deviceId) {
    selectedVideoInputId = deviceId;
    if (!peerConnection) {
      showToast("Camera preference saved", "📷");
      return;
    }
    if (callMode === "audio") {
      await upgradeToVideo();
      return;
    }
    try {
      const constraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === "video");
      if (sender) {
        await sender.replaceTrack(newTrack);
      } else {
        peerConnection.addTrack(newTrack, localStream);
      }

      if (localStream) {
        const oldTrack = localStream.getVideoTracks()[0];
        if (oldTrack) {
          localStream.removeTrack(oldTrack);
          oldTrack.stop();
        }
        localStream.addTrack(newTrack);
      }

      const localVideo = document.getElementById("localVideo");
      if (localVideo) {
        localVideo.srcObject = localStream;
      }
      showToast(`Camera switched: ${newTrack.label || "Selected cam"}`, "📷");
    } catch (e) {
      console.error("[WebRTC] switchVideoInput failed:", e);
      showToast("Could not switch camera: " + (e.message || "Unknown"), "⚠️");
    }
  }

  // Switch Audio Output (Speaker / Headphones) dynamically
  async function switchAudioOutput(deviceId) {
    selectedAudioOutputId = deviceId;
    const remoteVideo = document.getElementById("remoteVideo");
    if (!remoteVideo) return;
    if (typeof remoteVideo.setSinkId === "function") {
      try {
        await remoteVideo.setSinkId(deviceId || "");
        showToast("Audio output destination updated", "🔊");
      } catch (e) {
        console.warn("[WebRTC] setSinkId error:", e);
        showToast("Audio output switch failed: " + (e.message || "Hardware error"), "⚠️");
      }
    } else {
      showToast("Audio output switching not supported by this browser.", "ℹ️");
    }
  }

  // Live Speaker Test Tone Generator
  function testSpeakerOutput() {
    try {
      const ctx = getAudioContext();
      if (!ctx) {
        showToast("Web Audio not available for test.", "⚠️");
        return;
      }
      if (ctx.state === "suspended") ctx.resume();

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880.00, now + 0.15); // A5

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.5);

      showToast("Testing speaker chime… 🔔", "🔊");
    } catch (e) {
      console.warn("[WebRTC] testSpeakerOutput error:", e);
    }
  }

  // Toggle Inbuilt Media Hardware Drawer
  function toggleDeviceSettings() {
    const panel = document.getElementById("callDeviceSettingsPanel");
    if (!panel) return;
    const isOpen = panel.style.display !== "none";
    if (isOpen) {
      panel.style.display = "none";
    } else {
      panel.style.display = "flex";
      enumerateDevices();
    }
  }

  // PiP (Picture-in-Picture) Minimization
  function togglePip() {
    const modal = document.getElementById("callOverlay");
    const pipBtn = document.getElementById("callBtnPip");
    if (!modal) return;

    isPip = !isPip;
    modal.classList.toggle("pip-minimized", isPip);
    if (pipBtn) {
      pipBtn.textContent = isPip ? "🗖" : "🗕";
      pipBtn.title = isPip ? "Expand Call HUD" : "Minimize to PiP (keep chatting)";
    }
    showToast(isPip ? "Call minimized to corner. You can keep chatting!" : "Call HUD expanded", "🗖");
  }

  // Fullscreen Mode Toggle
  function toggleFullscreen() {
    const modal = document.getElementById("callOverlay");
    const fsBtn = document.getElementById("callBtnFullscreen");
    if (!modal) return;

    if (!document.fullscreenElement) {
      if (modal.requestFullscreen) {
        modal.requestFullscreen().catch(() => {});
      }
      modal.classList.add("call-fullscreen");
      isFullscreen = true;
      if (fsBtn) fsBtn.textContent = "🗗";
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      modal.classList.remove("call-fullscreen");
      isFullscreen = false;
      if (fsBtn) fsBtn.textContent = "⛶";
    }
  }

  function attachLocalMedia(stream) {
    const localVideo = document.getElementById("localVideo");
    if (localVideo) {
      localVideo.srcObject = stream;
    }
  }

  // Mode switcher: keeps Voice and Video HUD clean and decoupled
  function setCallMode(mode) {
    callMode = mode;
    const modal = document.getElementById("callModal");
    const badge = document.getElementById("callModeBadge");
    const videoStage = document.getElementById("callVideoStage");
    const audioStage = document.getElementById("callAudioStage");
    const upgradeBtn = document.getElementById("callBtnUpgradeVideo");
    const camBtn = document.getElementById("callBtnCam");

    if (mode === "audio") {
      if (modal) {
        modal.classList.add("voice-mode");
        modal.classList.remove("video-mode");
      }
      if (badge) {
        badge.textContent = "🎧 Voice Call";
        badge.classList.remove("badge-video");
        badge.classList.add("badge-voice");
      }
      if (videoStage) videoStage.style.display = "none";
      if (audioStage) audioStage.style.display = "flex";
      if (upgradeBtn) {
        upgradeBtn.style.display = "inline-flex";
        upgradeBtn.innerHTML = "📹 Video";
      }
      if (camBtn) camBtn.title = "Turn On Camera (Switch to Video)";
    } else {
      if (modal) {
        modal.classList.remove("voice-mode");
        modal.classList.add("video-mode");
      }
      if (badge) {
        badge.textContent = "📹 Video Call";
        badge.classList.remove("badge-voice");
        badge.classList.add("badge-video");
      }
      if (videoStage) videoStage.style.display = "flex";
      if (audioStage) audioStage.style.display = "none";
      if (upgradeBtn) {
        upgradeBtn.style.display = "none";
      }
      if (camBtn) camBtn.title = "Turn On/Off Camera";
    }
  }

  function showCallModal(target, statusText, type) {
    const modal = document.getElementById("callOverlay");
    if (modal) {
      modal.classList.add("open");
      modal.classList.remove("pip-minimized");
      isPip = false;
    }
    const nameEl = document.getElementById("callTargetName");
    if (nameEl) nameEl.textContent = `@${target}`;
    updateCallStatus(statusText);

    const audioTarget = document.getElementById("callAudioTarget");
    const audioAvatar = document.getElementById("callAudioAvatar");
    if (audioTarget) audioTarget.textContent = `@${target}`;
    if (audioAvatar) {
      const initStr = typeof initials === "function" ? initials(target) : (target ? target[0].toUpperCase() : "?");
      audioAvatar.textContent = initStr;
    }

    setCallMode(type);
    enumerateDevices();
  }

  function hideCallModal() {
    const modal = document.getElementById("callOverlay");
    if (modal) {
      modal.classList.remove("open");
      modal.classList.remove("pip-minimized");
      modal.classList.remove("call-fullscreen");
      isPip = false;
      isFullscreen = false;
    }
  }

  function updateCallStatus(text) {
    const stEl = document.getElementById("callStatusText");
    if (stEl) stEl.textContent = text;
  }

  function showIncomingCallBanner(sender, type, offerSignal) {
    const banner = document.getElementById("incomingCallBanner");
    if (!banner) return;
    document.getElementById("incomingCallerName").textContent = `@${sender}`;
    document.getElementById("incomingCallType").textContent = type === "video" ? "Incoming Video Call…" : "Incoming Voice Call…";

    const btnAccept = document.getElementById("btnAcceptCall");
    const btnDecline = document.getElementById("btnDeclineCall");

    btnAccept.onclick = () => acceptCall(sender, type, offerSignal);
    btnDecline.onclick = () => declineCall(sender);

    banner.classList.add("show");
  }

  function hideIncomingCallBanner() {
    const banner = document.getElementById("incomingCallBanner");
    if (banner) banner.classList.remove("show");
  }

  // Automatically refresh device list when audio/video hardware is plugged/unplugged
  if (typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      enumerateDevices();
    });
  }

  const api = {
    startCall,
    handleSignal,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    togglePip,
    toggleFullscreen,
    toggleDeviceSettings,
    switchAudioInput,
    switchVideoInput,
    switchAudioOutput,
    testSpeakerOutput,
    requestOrEnableVideo,
    upgradeToVideo,
    executeUpgradeToVideo,
    respondUpgradeRequest,
    startScreenShareStream,
    enumerateDevices,
    setCallMode
  };

  if (typeof window !== "undefined") {
    window.WebRTC = api;
  }
  return api;
})();
