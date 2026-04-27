(function () {
    // ─── UUID helper — works in both secure (https/localhost) and non-secure (http+IP) contexts ───
    function safeUUID() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        // Fallback: RFC 4122 v4 via crypto.getRandomValues
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Chaos Messenger — Crypto Engine v3
    // Protocol: X3DH for session establishment + Symmetric-key Ratchet for messages
    //
    // Symmetric Ratchet (simplified Double Ratchet):
    //   After each message the chainKey evolves:
    //     nextChainKey  = HMAC-SHA256(chainKey, 0x02)
    //     messageKey    = HMAC-SHA256(chainKey, 0x01)
    //   Each message is encrypted with a unique messageKey — old keys are never stored.
    //   This provides per-message forward secrecy.
    // ─────────────────────────────────────────────────────────────────────────

    const DEVICE_KEY_PREFIX    = 'cm_device_bundle_v2';
    const SESSION_KEY_PREFIX   = 'cm_e2ee_sessions_v4'; // v4 - fixed chain starts + self-device envelopes
    const DEVICE_ID_KEY_PREFIX = 'cm_device_id';

    let registrationPromise = null;
    let registrationPromiseUsername = null;

    // ─── Base64 utilities ───────────────────────────────────────────────────────

    function b64ToBytes(base64) {
        return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }

    function bytesToB64(bytes) {
        let binary = '';
        bytes.forEach(b => binary += String.fromCharCode(b));
        return btoa(binary);
    }

    function b64UrlToText(base64Url) {
        try {
            const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
            return atob(padded);
        } catch (_) { return ''; }
    }

    // ─── JWT username ──────────────────────────────────────────────────────────

    function getCurrentUsername() {
        const token = localStorage.getItem('cm_token') || '';
        const parts = token.split('.');
        if (parts.length < 2) return 'anonymous';
        const raw = b64UrlToText(parts[1]);
        if (!raw) return 'anonymous';
        try { return JSON.parse(raw)?.sub || 'anonymous'; } catch (_) { return 'anonymous'; }
    }

    function scopedKey(prefix) {
        return `${prefix}:${getCurrentUsername()}`;
    }

    function assertWebCryptoAvailable() {
        if (typeof crypto === 'undefined' || !crypto.subtle) {
            throw new Error('E2EE crypto is unavailable. Open the app via HTTPS or localhost. Mobile browsers usually block WebCrypto on plain http://LAN IP.');
        }
    }

    // ─── WebCrypto wrappers ───────────────────────────────────────────────────

    async function exportRawPublicKey(publicKey) {
        assertWebCryptoAvailable();
        const raw = await crypto.subtle.exportKey('raw', publicKey);
        return bytesToB64(new Uint8Array(raw));
    }

    async function exportPkcs8PrivateKey(privateKey) {
        assertWebCryptoAvailable();
        const raw = await crypto.subtle.exportKey('pkcs8', privateKey);
        return bytesToB64(new Uint8Array(raw));
    }

    async function importRawPublicKey(base64) {
        assertWebCryptoAvailable();
        return crypto.subtle.importKey('raw', b64ToBytes(base64), { name: 'X25519' }, true, []);
    }

    async function importPkcs8PrivateKey(base64) {
        assertWebCryptoAvailable();
        return crypto.subtle.importKey('pkcs8', b64ToBytes(base64), { name: 'X25519' }, true, ['deriveBits']);
    }

    async function generateX25519KeyPair() {
        assertWebCryptoAvailable();
        return crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
    }

    async function derive32(privateKey, publicKey) {
        assertWebCryptoAvailable();
        const bits = await crypto.subtle.deriveBits({ name: 'X25519', public: publicKey }, privateKey, 256);
        return new Uint8Array(bits);
    }

    async function hmacSha256(keyBytes, dataBytes) {
        assertWebCryptoAvailable();
        const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, dataBytes);
        return new Uint8Array(sig);
    }

    async function sha256Base64(text) {
        assertWebCryptoAvailable();
        const bytes = new TextEncoder().encode(text);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return bytesToB64(new Uint8Array(digest));
    }

    // ─── HKDF ────────────────────────────────────────────────────────────────

    async function hkdfExtract(salt, ikm) {
        return hmacSha256(salt && salt.length ? salt : new Uint8Array(32), ikm);
    }

    async function hkdfExpand(prk, info, length) {
        let output = new Uint8Array(length);
        let previous = new Uint8Array(0);
        let generated = 0, counter = 1;
        while (generated < length) {
            const input = new Uint8Array(previous.length + info.length + 1);
            input.set(previous, 0);
            input.set(info, previous.length);
            input[input.length - 1] = counter;
            previous = await hmacSha256(prk, input);
            const toCopy = Math.min(previous.length, length - generated);
            output.set(previous.slice(0, toCopy), generated);
            generated += toCopy;
            counter++;
        }
        return output;
    }

    async function deriveRootAndChainKey(sharedSecretBytes) {
        const prk = await hkdfExtract(new Uint8Array(32), sharedSecretBytes);
        const okm = await hkdfExpand(prk, new TextEncoder().encode('CHAOS_MESSENGER_SESSION_V3'), 64);
        return { rootKey: okm.slice(0, 32), chainKey: okm.slice(32, 64) };
    }

    // ─── Symmetric Ratchet ───────────────────────────────────────────────────
    //
    // Each ratchet step:
    //   messageKey   = HMAC(chainKey, 0x01)  — used to encrypt the current message
    //   nextChainKey = HMAC(chainKey, 0x02)  — stored; old chainKey is discarded
    //
    // Forward secrecy: given nextChainKey it is impossible to recover previous messageKey.

    async function ratchetStep(chainKeyBytes) {
        const messageKey  = await hmacSha256(chainKeyBytes, new Uint8Array([0x01]));
        const nextChainKey = await hmacSha256(chainKeyBytes, new Uint8Array([0x02]));
        return { messageKey, nextChainKey };
    }

    // ─── AES-GCM encryption with messageKey ─────────────────────────────────

    async function aesEncryptWithKey(plainText, messageKeyBytes) {
        const key = await crypto.subtle.importKey('raw', messageKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plainText);
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, encoded);
        return { ciphertext: bytesToB64(new Uint8Array(encrypted)), nonce: bytesToB64(nonce) };
    }

    async function aesDecryptWithKey(ciphertextBase64, nonceBase64, messageKeyBytes) {
        const key = await crypto.subtle.importKey('raw', messageKeyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: b64ToBytes(nonceBase64) },
            key,
            b64ToBytes(ciphertextBase64)
        );
        return new TextDecoder().decode(plaintext);
    }

    async function deriveSelfEnvelopeKey(localBundle) {
        assertWebCryptoAvailable();
        const material = [
            'CHAOS_MESSENGER_SELF_ENVELOPE_V1',
            localBundle.deviceId,
            localBundle.identity.publicKey,
            localBundle.identity.privateKeyPkcs8
        ].join(':');
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
        return new Uint8Array(digest);
    }

    async function encryptSelfEnvelope(localBundle, plainText) {
        const key = await deriveSelfEnvelopeKey(localBundle);
        return aesEncryptWithKey(plainText, key);
    }

    async function decryptSelfEnvelope(localBundle, envelope) {
        const key = await deriveSelfEnvelopeKey(localBundle);
        return aesDecryptWithKey(envelope.ciphertext, envelope.nonce, key);
    }

    // ─── Session storage ──────────────────────────────────────────────────────

    function getOrCreateDeviceId() {
        const key = scopedKey(DEVICE_ID_KEY_PREFIX);
        let id = localStorage.getItem(key);
        if (!id) { id = 'device-' + safeUUID(); localStorage.setItem(key, id); }
        return id;
    }

    function randomRegistrationId() {
        const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); return bytes[0] & 0x7fffffff;
    }

    function loadJson(key) {
        const raw = localStorage.getItem(scopedKey(key));
        return raw ? JSON.parse(raw) : null;
    }

    function saveJson(key, value) {
        localStorage.setItem(scopedKey(key), JSON.stringify(value));
    }

    function getLocalDeviceBundle() { return loadJson(DEVICE_KEY_PREFIX); }
    function loadSessions() { return loadJson(SESSION_KEY_PREFIX) || {}; }
    function saveSessions(sessions) { saveJson(SESSION_KEY_PREFIX, sessions); }

    function sessionKey(localDeviceId, remoteDeviceId) {
        return `device:${localDeviceId}:remote:${remoteDeviceId}`;
    }

    function getSession(localDeviceId, remoteDeviceId) {
        return loadSessions()[sessionKey(localDeviceId, remoteDeviceId)] || null;
    }

    function storeSession(localDeviceId, remoteDeviceId, session) {
        const sessions = loadSessions();
        sessions[sessionKey(localDeviceId, remoteDeviceId)] = session;
        saveSessions(sessions);
    }

    // ─── Device bundle generation and registration ───────────────────────────

    async function buildNewDeviceBundle() {
        // Always generate a fresh UUID when rebuilding the bundle,
        // Peers will perform a fresh X3DH instead of trying to reuse the old session
        const deviceId = 'device-' + safeUUID();
        localStorage.setItem(scopedKey(DEVICE_ID_KEY_PREFIX), deviceId);
        log('[E2EE] New deviceId:', deviceId);
        const registrationId = randomRegistrationId();
        const identity = await generateX25519KeyPair();
        const signedPreKey = await generateX25519KeyPair();
        const oneTimePreKeys = [];
        for (let i = 0; i < 50; i++) {
            const kp = await generateX25519KeyPair();
            oneTimePreKeys.push({
                preKeyId: 1000 + i,
                publicKey: await exportRawPublicKey(kp.publicKey),
                privateKeyPkcs8: await exportPkcs8PrivateKey(kp.privateKey)
            });
        }
        const signedPreKeyPublic  = await exportRawPublicKey(signedPreKey.publicKey);
        const identityPrivate     = await exportPkcs8PrivateKey(identity.privateKey);
        const identityPublic      = await exportRawPublicKey(identity.publicKey);

        // FIX: real ECDSA P-256 signature replacing the former SHA-256 hash stub.
        // The signing key is a separate key pair (identity key stays X25519 for ECDH).
        const signingKeyPair = await crypto.subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' },
            true,
            ['sign', 'verify']
        );
        const signingPublicKeySpki = await crypto.subtle.exportKey('spki', signingKeyPair.publicKey);
        const signingPublicKey     = bytesToB64(new Uint8Array(signingPublicKeySpki));
        const signingPrivateKeyPkcs8Raw = await crypto.subtle.exportKey('pkcs8', signingKeyPair.privateKey);
        const signingPrivateKeyPkcs8    = bytesToB64(new Uint8Array(signingPrivateKeyPkcs8Raw));

        const signedPreKeyBytes = b64ToBytes(signedPreKeyPublic);
        const signatureBuf = await crypto.subtle.sign(
            { name: 'ECDSA', hash: { name: 'SHA-256' } },
            signingKeyPair.privateKey,
            signedPreKeyBytes
        );
        const signedPreKeySignature = bytesToB64(new Uint8Array(signatureBuf));

        return {
            deviceId, registrationId,
            identity: { publicKey: identityPublic, privateKeyPkcs8: identityPrivate },
            signingKey: { publicKeySpki: signingPublicKey, privateKeyPkcs8: signingPrivateKeyPkcs8 },
            signedPreKey: {
                preKeyId: 1,
                publicKey: signedPreKeyPublic,
                privateKeyPkcs8: await exportPkcs8PrivateKey(signedPreKey.privateKey),
                signature: signedPreKeySignature
            },
            oneTimePreKeys
        };
    }

    function log(...args) {
        console.log('[ChaosMessenger]', ...args);
    }

    async function registerBundleOnServer(api, bundle, isNewDevice = false) {
        const body = {
            deviceId: bundle.deviceId,
            deviceName: navigator.userAgent,
            registrationId: bundle.registrationId,
            identityPublicKey: bundle.identity.publicKey,
            // FIX: send the SPKI key so the server can verify the ECDSA signature
            signingPublicKey: bundle.signingKey?.publicKeySpki || null,
            signedPreKey: {
                preKeyId: bundle.signedPreKey.preKeyId,
                publicKey: bundle.signedPreKey.publicKey,
                signature: bundle.signedPreKey.signature
            },
            // Upload OTP only for a new device
            // Do not touch OTP on re-registration, otherwise active sessions break
            oneTimePreKeys: isNewDevice
                ? bundle.oneTimePreKeys.map(k => ({ preKeyId: k.preKeyId, publicKey: k.publicKey }))
                : []
        };
        log('[E2EE] registerBundleOnServer isNew=' + isNewDevice, 'deviceId=' + bundle.deviceId);
        await api('/api/crypto/devices/register', {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    async function ensureDeviceRegistered(api) {
        const username = getCurrentUsername();
        const canRegister = !!(api && (api.__canRegisterDevice || api.canRegisterDevice));

        // registrationPromise is module-level. Without username scoping, switching
        // accounts in the same SPA session reuses the previous user's resolved promise
        // and the new user's device never reaches the backend.
        if (registrationPromise && registrationPromiseUsername === username) return registrationPromise;
        registrationPromiseUsername = username;

        registrationPromise = (async () => {
            let bundle = getLocalDeviceBundle();
            let shouldUploadOneTimeKeys = false;

            if (!bundle) {
                log('[E2EE] New device — generating keys');
                bundle = await buildNewDeviceBundle();
                saveJson(DEVICE_KEY_PREFIX, bundle);
                shouldUploadOneTimeKeys = true;
            } else if (!bundle?.signingKey?.publicKeySpki) {
                // Legacy bundle without a real signing key — recreate device.
                log('[E2EE] Legacy bundle without signingKey detected — recreating device');
                localStorage.removeItem(scopedKey(DEVICE_KEY_PREFIX));
                localStorage.removeItem(scopedKey(SESSION_KEY_PREFIX));
                bundle = await buildNewDeviceBundle();
                saveJson(DEVICE_KEY_PREFIX, bundle);
                shouldUploadOneTimeKeys = true;
            }

            // After OTP/email login the wrapper passes a short-lived registration token.
            // In that flow we always upsert the current local device. This also heals
            // the common dev/MVP case: browser still has the bundle, but DB/devices were reset.
            if (shouldUploadOneTimeKeys || canRegister) {
                await registerBundleOnServer(api, bundle, true);
            } else {
                log('[E2EE] Existing device detected, skipping re-registration:', bundle.deviceId);
            }
            return bundle;
        })().catch((err) => {
            registrationPromise = null;
            registrationPromiseUsername = null;
            throw err;
        });
        return registrationPromise;
    }

    // ─── X3DH session establishment (initiator) ───────────────────────────────

    async function createInitiatorSession(localBundle, targetDevice) {
        log('[X3DH] Establishing session with device:', targetDevice.deviceId);
        const identityPrivate     = await importPkcs8PrivateKey(localBundle.identity.privateKeyPkcs8);
        const ephemeral           = await generateX25519KeyPair();
        const ephemeralPublicKey  = await exportRawPublicKey(ephemeral.publicKey);
        const remoteIdentityPub   = await importRawPublicKey(targetDevice.identityPublicKey);
        const remoteSignedPreKeyPub = await importRawPublicKey(targetDevice.signedPreKey.publicKey);

        const dh1 = await derive32(identityPrivate, remoteSignedPreKeyPub);
        const dh2 = await derive32(ephemeral.privateKey, remoteIdentityPub);
        const dh3 = await derive32(ephemeral.privateKey, remoteSignedPreKeyPub);

        let combined;
        if (targetDevice.oneTimePreKey?.publicKey) {
            const remoteOneTimePub = await importRawPublicKey(targetDevice.oneTimePreKey.publicKey);
            const dh4 = await derive32(ephemeral.privateKey, remoteOneTimePub);
            combined = new Uint8Array(dh1.length + dh2.length + dh3.length + dh4.length);
            combined.set(dh1, 0);
            combined.set(dh2, dh1.length);
            combined.set(dh3, dh1.length + dh2.length);
            combined.set(dh4, dh1.length + dh2.length + dh3.length);
        } else {
            combined = new Uint8Array(dh1.length + dh2.length + dh3.length);
            combined.set(dh1, 0);
            combined.set(dh2, dh1.length);
            combined.set(dh3, dh1.length + dh2.length);
        }

        const keys = await deriveRootAndChainKey(combined);
        const session = {
            localDeviceId: localBundle.deviceId,
            remoteDeviceId: targetDevice.deviceId,
            rootKey: bytesToB64(keys.rootKey),
            // Sending chain - ratchet for outgoing messages
            sendingChainStartKey: bytesToB64(keys.chainKey),
            sendingChainKey: bytesToB64(keys.chainKey),
            sendingIndex: 0,
            // Receiving chain for replies starts from rootKey on the initiator side
            receivingChainStartKey: bytesToB64(keys.rootKey),
            receivingChainKey: null,
            receivingIndex: 0,
            senderIdentityPublicKey: localBundle.identity.publicKey,
            establishedAt: Date.now(),
            version: 3
        };
        storeSession(localBundle.deviceId, targetDevice.deviceId, session);
        return { session, ephemeralPublicKey };
    }

    // ─── X3DH session establishment (recipient) ──────────────────────────────

    async function bootstrapRecipientSession(localBundle, envelope) {
        const identityPrivate      = await importPkcs8PrivateKey(localBundle.identity.privateKeyPkcs8);
        const signedPreKeyPrivate  = await importPkcs8PrivateKey(localBundle.signedPreKey.privateKeyPkcs8);
        const senderIdentityPub    = await importRawPublicKey(envelope.senderIdentityPublicKey);
        const ephemeralPub         = await importRawPublicKey(envelope.ephemeralPublicKey);

        const dh1 = await derive32(signedPreKeyPrivate, senderIdentityPub);
        const dh2 = await derive32(identityPrivate, ephemeralPub);
        const dh3 = await derive32(signedPreKeyPrivate, ephemeralPub);

        let combined;
        if (envelope.oneTimePreKeyId != null) {
            const oneTime = localBundle.oneTimePreKeys.find(k => k.preKeyId === envelope.oneTimePreKeyId);
            if (!oneTime) throw new Error('One-time prekey not found locally: ' + envelope.oneTimePreKeyId);
            const oneTimePrivate = await importPkcs8PrivateKey(oneTime.privateKeyPkcs8);
            const dh4 = await derive32(oneTimePrivate, ephemeralPub);
            combined = new Uint8Array(dh1.length + dh2.length + dh3.length + dh4.length);
            combined.set(dh1, 0);
            combined.set(dh2, dh1.length);
            combined.set(dh3, dh1.length + dh2.length);
            combined.set(dh4, dh1.length + dh2.length + dh3.length);
        } else {
            combined = new Uint8Array(dh1.length + dh2.length + dh3.length);
            combined.set(dh1, 0);
            combined.set(dh2, dh1.length);
            combined.set(dh3, dh1.length + dh2.length);
        }

        const keys = await deriveRootAndChainKey(combined);

        // Recipient mirrors the initiator: recipient's receiving chain = initiator's sending chain
        storeSession(localBundle.deviceId, envelope.senderDeviceId, {
            localDeviceId: localBundle.deviceId,
            remoteDeviceId: envelope.senderDeviceId,
            rootKey: bytesToB64(keys.rootKey),
            // Replies from recipient to initiator start from rootKey
            sendingChainStartKey: bytesToB64(keys.rootKey),
            sendingChainKey: null,         // recipient has not sent yet
            sendingIndex: 0,
            // Incoming initiator messages start from the X3DH chainKey
            receivingChainStartKey: bytesToB64(keys.chainKey),
            receivingChainKey: bytesToB64(keys.chainKey), // mirror of the initiator sending chain
            receivingIndex: 0,
            senderIdentityPublicKey: envelope.senderIdentityPublicKey,
            establishedAt: Date.now(),
            version: 3
        });

        return keys;
    }

    // ─── Single-message encryption with ratchet ──────────────────────────────

    async function encryptWithRatchet(session, plainText) {
        // If sendingChainKey is not yet set, bootstrap from an immutable chain start.
        // Initiator -> recipient starts from X3DH chainKey.
        // Recipient -> initiator replies start from rootKey.
        let chainKeyBytes;
        if (!session.sendingChainStartKey) {
            session.sendingChainStartKey = session.sendingChainKey || session.rootKey;
        }
        if (!session.sendingChainKey) {
            chainKeyBytes = b64ToBytes(session.sendingChainStartKey);
            session.sendingChainKey = session.sendingChainStartKey;
        } else {
            chainKeyBytes = b64ToBytes(session.sendingChainKey);
        }

        const { messageKey, nextChainKey } = await ratchetStep(chainKeyBytes);

        // Update the session by replacing the old chainKey with the next one
        session.sendingChainKey = bytesToB64(nextChainKey);
        session.sendingIndex = (session.sendingIndex || 0) + 1;

        const encrypted = await aesEncryptWithKey(plainText, messageKey);
        return { encrypted, messageIndex: session.sendingIndex - 1 };
    }

    // ─── Decrypt one ratcheted message ──────────────────────────────────────────

    async function decryptWithRatchet(session, envelope) {
        const targetIndex = envelope.messageIndex ?? 0;
        let chainKeyBytes;

        if (!session.receivingChainStartKey) {
            session.receivingChainStartKey = session.receivingChainKey || session.rootKey;
        }

        if (!session.receivingChainKey) {
            // First incoming message starts from the immutable receiving-chain start.
            chainKeyBytes = b64ToBytes(session.receivingChainStartKey);
            session.receivingChainKey = session.receivingChainStartKey;
            session.receivingIndex = 0;
        } else {
            chainKeyBytes = b64ToBytes(session.receivingChainKey);
        }

        let currentIndex = session.receivingIndex || 0;

        // If targetIndex < currentIndex, this is a timeline duplicate or history reload.
        // Recompute from the correct receiving-chain start, not from rootKey.
        if (targetIndex < currentIndex) {
            chainKeyBytes = b64ToBytes(session.receivingChainStartKey);
            currentIndex = 0;
        }

        // Advance the ratchet to the required position
        while (currentIndex < targetIndex) {
            const step = await ratchetStep(chainKeyBytes);
            chainKeyBytes = step.nextChainKey;
            currentIndex++;
        }

        const { messageKey, nextChainKey } = await ratchetStep(chainKeyBytes);

        // Update the receiving chain only when moving forward
        if (targetIndex >= (session.receivingIndex || 0)) {
            session.receivingChainKey = bytesToB64(nextChainKey);
            session.receivingIndex = currentIndex + 1;
        }

        return aesDecryptWithKey(envelope.ciphertext, envelope.nonce, messageKey);
    }

    // ─── Build one envelope for a target device ────────────────────────────────

    async function buildEnvelopeForTarget(localBundle, targetDevice, plainText) {
        let session = getSession(localBundle.deviceId, targetDevice.deviceId);
        let isNewSession = false;

        if (!session) {
            const created = await createInitiatorSession(localBundle, targetDevice);
            session = created.session;
            isNewSession = true;
        }

        const { encrypted, messageIndex } = await encryptWithRatchet(session, plainText);

        // Persist the updated session with the new chainKey
        storeSession(localBundle.deviceId, targetDevice.deviceId, session);

        return {
            targetDeviceId: targetDevice.deviceId,
            targetUserId: targetDevice.userId,
            messageType: isNewSession ? 'PREKEY_WHISPER' : 'WHISPER',
            senderIdentityPublicKey: localBundle.identity.publicKey,
            ephemeralPublicKey: isNewSession ? session._ephemeralPublicKey || null : null,
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce,
            messageIndex,                    // required by the recipient to synchronize the ratchet
            signedPreKeyId: isNewSession && targetDevice.signedPreKey ? targetDevice.signedPreKey.preKeyId : null,
            oneTimePreKeyId: isNewSession && targetDevice.oneTimePreKey ? targetDevice.oneTimePreKey.preKeyId : null,
            timestamp: Date.now()
        };
    }

    // Patch createInitiatorSession: store ephemeralPublicKey in the session
    const _origCreate = createInitiatorSession;
    // (using the closure wrapper below)

    async function createInitiatorSessionWrapped(localBundle, targetDevice) {
        const identityPrivate       = await importPkcs8PrivateKey(localBundle.identity.privateKeyPkcs8);
        const ephemeral             = await generateX25519KeyPair();
        const ephemeralPublicKey    = await exportRawPublicKey(ephemeral.publicKey);
        const remoteIdentityPub     = await importRawPublicKey(targetDevice.identityPublicKey);
        const remoteSignedPreKeyPub = await importRawPublicKey(targetDevice.signedPreKey.publicKey);

        const dh1 = await derive32(identityPrivate, remoteSignedPreKeyPub);
        const dh2 = await derive32(ephemeral.privateKey, remoteIdentityPub);
        const dh3 = await derive32(ephemeral.privateKey, remoteSignedPreKeyPub);

        let combined;
        if (targetDevice.oneTimePreKey?.publicKey) {
            const remoteOneTimePub = await importRawPublicKey(targetDevice.oneTimePreKey.publicKey);
            const dh4 = await derive32(ephemeral.privateKey, remoteOneTimePub);
            combined = new Uint8Array(dh1.length + dh2.length + dh3.length + dh4.length);
            combined.set(dh1, 0); combined.set(dh2, dh1.length);
            combined.set(dh3, dh1.length + dh2.length); combined.set(dh4, dh1.length + dh2.length + dh3.length);
        } else {
            combined = new Uint8Array(dh1.length + dh2.length + dh3.length);
            combined.set(dh1, 0); combined.set(dh2, dh1.length); combined.set(dh3, dh1.length + dh2.length);
        }

        const keys = await deriveRootAndChainKey(combined);
        const session = {
            localDeviceId: localBundle.deviceId,
            remoteDeviceId: targetDevice.deviceId,
            rootKey: bytesToB64(keys.rootKey),
            sendingChainStartKey: bytesToB64(keys.chainKey),
            sendingChainKey: bytesToB64(keys.chainKey),
            sendingIndex: 0,
            receivingChainStartKey: bytesToB64(keys.rootKey),
            receivingChainKey: null,
            receivingIndex: 0,
            senderIdentityPublicKey: localBundle.identity.publicKey,
            _ephemeralPublicKey: ephemeralPublicKey, // store for the first envelope
            establishedAt: Date.now(),
            version: 3
        };
        storeSession(localBundle.deviceId, targetDevice.deviceId, session);
        return { session, ephemeralPublicKey };
    }

    // ─── Fanout (send to chat) ─────────────────────────────────────────────────

    async function buildFanoutRequest(api, chatId, plainText) {
        const localBundle = await ensureDeviceRegistered(api);
        const resolved = await api('/api/crypto/resolve-chat-devices/' + encodeURIComponent(chatId), { method: 'POST' });

        const envelopes = [];
        const uniqueTargets = new Map();
        for (const dev of (resolved.targetDevices || [])) {
            if (dev?.deviceId && !uniqueTargets.has(dev.deviceId)) {
                uniqueTargets.set(dev.deviceId, dev);
            }
        }

        for (const targetDevice of uniqueTargets.values()) {
            // Current sender device must not use the normal session slot against itself:
            // otherwise PREKEY decrypt overwrites the outgoing ratchet and own sent
            // messages become [encrypted] after a few sends or after history reload.
            if (targetDevice.deviceId === localBundle.deviceId) {
                const encrypted = await encryptSelfEnvelope(localBundle, plainText);
                envelopes.push({
                    targetDeviceId: targetDevice.deviceId,
                    targetUserId: targetDevice.userId,
                    messageType: 'SELF_WHISPER',
                    senderIdentityPublicKey: localBundle.identity.publicKey,
                    ephemeralPublicKey: null,
                    ciphertext: encrypted.ciphertext,
                    nonce: encrypted.nonce,
                    messageIndex: null,
                    signedPreKeyId: null,
                    oneTimePreKeyId: null,
                    timestamp: Date.now()
                });
                continue;
            }

            let session = getSession(localBundle.deviceId, targetDevice.deviceId);
            let ephemeralPublicKey = null;
            let isNewSession = false;

            if (!session) {
                const created = await createInitiatorSessionWrapped(localBundle, targetDevice);
                session = created.session;
                ephemeralPublicKey = created.ephemeralPublicKey;
                isNewSession = true;
            }

            const { encrypted, messageIndex } = await encryptWithRatchet(session, plainText);
            storeSession(localBundle.deviceId, targetDevice.deviceId, session);

            envelopes.push({
                targetDeviceId: targetDevice.deviceId,
                targetUserId: targetDevice.userId,
                messageType: isNewSession ? 'PREKEY_WHISPER' : 'WHISPER',
                senderIdentityPublicKey: localBundle.identity.publicKey,
                ephemeralPublicKey: isNewSession ? ephemeralPublicKey : null,
                ciphertext: encrypted.ciphertext,
                nonce: encrypted.nonce,
                messageIndex,
                signedPreKeyId: isNewSession && targetDevice.signedPreKey ? targetDevice.signedPreKey.preKeyId : null,
                oneTimePreKeyId: isNewSession && targetDevice.oneTimePreKey ? targetDevice.oneTimePreKey.preKeyId : null,
                timestamp: Date.now()
            });
        }

        return {
            chatId,
            clientMessageId: safeUUID(),
            senderDeviceId: localBundle.deviceId,
            envelopes
        };
    }

    // ─── Decrypt an incoming envelope ─────────────────────────────────────────

    async function decryptEnvelope(envelope) {
        const localBundle = getLocalDeviceBundle();
        if (!localBundle) throw new Error('Local device bundle is missing');

        log('[decrypt] senderDeviceId=' + envelope.senderDeviceId + ' messageType=' + envelope.messageType + ' messageIndex=' + envelope.messageIndex);

        if (envelope.messageType === 'SELF_WHISPER') {
            return decryptSelfEnvelope(localBundle, envelope);
        }

        let session = getSession(localBundle.deviceId, envelope.senderDeviceId);

        // PREKEY_WHISPER establishes an X3DH session
        if (envelope.messageType === 'PREKEY_WHISPER') {
            log('[decrypt] Bootstrap X3DH session with', envelope.senderDeviceId);
            await bootstrapRecipientSession(localBundle, envelope);
            session = getSession(localBundle.deviceId, envelope.senderDeviceId);
        }

        if (!session) {
            throw new Error('No session for device ' + envelope.senderDeviceId);
        }

        // Decrypt with the ratchet
        const plainText = await decryptWithRatchet(session, envelope);

        // Persist the updated session after the receiving chain advanced
        storeSession(localBundle.deviceId, envelope.senderDeviceId, session);

        log('[decrypt] OK messageIndex=' + envelope.messageIndex);
        return plainText;
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    window.e2ee = {
        getOrCreateDeviceId,
        getLocalDeviceBundle,
        ensureDeviceRegistered,
        buildFanoutRequest,
        decryptEnvelope
    };

})();
