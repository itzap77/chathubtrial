// ==========================================================================
// CHATHUB CLIENT-SIDE END-TO-END ENCRYPTION (E2EE) MODULE
// Native Browser Web Crypto API (ECDH P-256 + PBKDF2 + AES-256-GCM)
// Zero server knowledge: messages are encrypted/decrypted only in browser.
// ==========================================================================

const E2EE = (function() {
  const roomKeyCache = new Map();
  const dmKeyCache = new Map();
  let myEcdhKeyPair = null;

  // Base64 Helpers
  function bufferToBase64(buf) {
    const bin = String.fromCharCode.apply(null, new Uint8Array(buf));
    return window.btoa(bin);
  }

  function base64ToBuffer(b64) {
    const bin = window.atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // 1. Initialize ECDH KeyPair for Direct Messages
  async function initUserIdentityKeys(username, token) {
    if (!username || !window.crypto || !window.crypto.subtle) return;
    const privStorageKey = `chathub_ecdh_priv_${username}`;
    const pubStorageKey = `chathub_ecdh_pub_${username}`;

    try {
      let privJwk = null;
      let pubJwk = null;

      const savedPriv = localStorage.getItem(privStorageKey);
      const savedPub = localStorage.getItem(pubStorageKey);

      if (savedPriv && savedPub) {
        privJwk = JSON.parse(savedPriv);
        pubJwk = JSON.parse(savedPub);
      } else {
        // Generate Curve P-256 ECDH KeyPair
        const pair = await window.crypto.subtle.generateKey(
          { name: "ECDH", namedCurve: "P-256" },
          true,
          ["deriveKey", "deriveBits"]
        );
        privJwk = await window.crypto.subtle.exportKey("jwk", pair.privateKey);
        pubJwk = await window.crypto.subtle.exportKey("jwk", pair.publicKey);

        localStorage.setItem(privStorageKey, JSON.stringify(privJwk));
        localStorage.setItem(pubStorageKey, JSON.stringify(pubJwk));
      }

      myEcdhKeyPair = { privJwk, pubJwk };

      // Publish public key to server
      if (token && pubJwk) {
        const formData = new FormData();
        formData.append("token", token);
        formData.append("public_key", JSON.stringify(pubJwk));
        await fetch("/api/users/keys", { method: "POST", body: formData });
      }
    } catch (e) {
      console.warn("E2EE: Failed to init ECDH keys:", e);
    }
  }

  // 2. Derive Shared Key for DMs (ECDH -> AES-256-GCM)
  async function getDmSharedKey(otherUsername, token) {
    if (!otherUsername || !myEcdhKeyPair || !token) return null;
    const cacheKey = otherUsername.toLowerCase();
    if (dmKeyCache.has(cacheKey)) return dmKeyCache.get(cacheKey);

    try {
      // Fetch recipient's public key
      const res = await fetch(`/api/users/keys?username=${encodeURIComponent(otherUsername)}&token=${encodeURIComponent(token)}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.public_key) return null;

      const recipientPubJwk = JSON.parse(data.public_key);

      const recipientPubKey = await window.crypto.subtle.importKey(
        "jwk",
        recipientPubJwk,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        []
      );

      const myPrivKey = await window.crypto.subtle.importKey(
        "jwk",
        myEcdhKeyPair.privJwk,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveKey"]
      );

      const sharedAesKey = await window.crypto.subtle.deriveKey(
        { name: "ECDH", public: recipientPubKey },
        myPrivKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );

      dmKeyCache.set(cacheKey, sharedAesKey);
      return sharedAesKey;
    } catch (e) {
      console.warn("E2EE: Failed to derive DM shared key:", e);
      return null;
    }
  }

  // 3. Derive Room Key from Passkey (PBKDF2 -> AES-256-GCM)
  async function deriveRoomKey(roomId, passkey) {
    if (!roomId || !passkey || !window.crypto || !window.crypto.subtle) return null;
    const cacheKey = roomId.toLowerCase();
    if (roomKeyCache.has(cacheKey)) return roomKeyCache.get(cacheKey);

    try {
      const enc = new TextEncoder();
      const baseKey = await window.crypto.subtle.importKey(
        "raw",
        enc.encode(passkey),
        "PBKDF2",
        false,
        ["deriveKey"]
      );

      const salt = enc.encode(`chathub_salt_${roomId}`);

      const aesKey = await window.crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: salt,
          iterations: 100000,
          hash: "SHA-256"
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );

      roomKeyCache.set(cacheKey, aesKey);
      return aesKey;
    } catch (e) {
      console.warn("E2EE: Failed to derive room key:", e);
      return null;
    }
  }

  function setRoomKey(roomId, key) {
    roomKeyCache.set(roomId.toLowerCase(), key);
  }

  function hasRoomKey(roomId) {
    return roomKeyCache.has(roomId.toLowerCase());
  }

  // 4. Encrypt Plaintext Payload
  async function encrypt(plaintext, cryptoKey) {
    if (!cryptoKey || !plaintext) return plaintext;
    try {
      const enc = new TextEncoder();
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encoded = enc.encode(plaintext);

      const cipher = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        cryptoKey,
        encoded
      );

      const payload = {
        v: 1,
        iv: bufferToBase64(iv.buffer),
        c: bufferToBase64(cipher)
      };

      return "e2ee:" + JSON.stringify(payload);
    } catch (e) {
      console.warn("E2EE: Encryption failed:", e);
      return plaintext;
    }
  }

  // 5. Decrypt Payload
  async function decrypt(messageText, cryptoKey) {
    if (!messageText || typeof messageText !== "string" || !messageText.startsWith("e2ee:")) {
      return { text: messageText, isEncrypted: false };
    }

    if (!cryptoKey) {
      return {
        text: "🔒 Encrypted Message (Unlock key required to view)",
        isEncrypted: true,
        locked: true
      };
    }

    try {
      const rawJson = messageText.substring(5);
      const payload = JSON.parse(rawJson);
      const iv = base64ToBuffer(payload.iv);
      const cipher = base64ToBuffer(payload.c);

      const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) },
        cryptoKey,
        cipher
      );

      const dec = new TextDecoder();
      return {
        text: dec.decode(decrypted),
        isEncrypted: true,
        locked: false
      };
    } catch (e) {
      return {
        text: "🔒 Encrypted Message (Invalid key or decryption error)",
        isEncrypted: true,
        locked: true
      };
    }
  }

  async function getPublicKeyFingerprint() {
    if (!myEcdhKeyPair || !myEcdhKeyPair.pubJwk) return "KEYPAIR NOT INITIALIZED";
    try {
      const canonical = JSON.stringify(myEcdhKeyPair.pubJwk);
      const enc = new TextEncoder();
      const hash = await window.crypto.subtle.digest("SHA-256", enc.encode(canonical));
      const hashArray = Array.from(new Uint8Array(hash));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
      const chunks = [];
      for (let i = 0; i < 32; i += 4) {
        chunks.push(hashHex.substring(i, i + 4));
      }
      return chunks.join(" • ");
    } catch (e) {
      return "FINGERPRINT ERROR";
    }
  }

  function getPublicKeyJwk() {
    if (!myEcdhKeyPair || !myEcdhKeyPair.pubJwk) return null;
    return JSON.stringify(myEcdhKeyPair.pubJwk, null, 2);
  }

  async function rotateIdentityKeys(username, token) {
    if (!username || !window.crypto || !window.crypto.subtle) return null;
    const privStorageKey = `chathub_ecdh_priv_${username}`;
    const pubStorageKey = `chathub_ecdh_pub_${username}`;

    try {
      const pair = await window.crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey", "deriveBits"]
      );
      const privJwk = await window.crypto.subtle.exportKey("jwk", pair.privateKey);
      const pubJwk = await window.crypto.subtle.exportKey("jwk", pair.publicKey);

      localStorage.setItem(privStorageKey, JSON.stringify(privJwk));
      localStorage.setItem(pubStorageKey, JSON.stringify(pubJwk));

      myEcdhKeyPair = { privJwk, pubJwk };
      dmKeyCache.clear();

      if (token && pubJwk) {
        const formData = new FormData();
        formData.append("token", token);
        formData.append("public_key", JSON.stringify(pubJwk));
        await fetch("/api/users/keys", { method: "POST", body: formData });
      }

      return await getPublicKeyFingerprint();
    } catch (e) {
      console.error("E2EE: Failed to rotate ECDH keys:", e);
      throw e;
    }
  }

  const api = {
    initUserIdentityKeys,
    getDmSharedKey,
    deriveRoomKey,
    setRoomKey,
    hasRoomKey,
    encrypt,
    decrypt,
    getPublicKeyFingerprint,
    getPublicKeyJwk,
    rotateIdentityKeys
  };

  if (typeof window !== "undefined") {
    window.E2EE = api;
  }
  return api;
})();

