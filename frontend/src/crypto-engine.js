(function () {
    // ─── UUID helper — works in both secure (https/localhost) and non-secure (http+IP) contexts ───
    function safeUUID() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
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

    // Storage keys — NOT scoped by username (device identity is independent of user account)
    const DEVICE_KEY_PREFIX    = 'cm_device_bundle_v2';
    const SESSION_KEY_PREFIX   = 'cm_e2ee_sessions_v4';
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

    // ─── JWT username (used only for registrationPromise scoping) ─────────────

    function getCurrentUsername() {
        const token = localStorage.getItem('cm_token') || '';
        const parts = token.split('.');
        if (parts.length < 2) return 'anonymous';
        const raw = b64UrlToText(parts[1]);
        if (!raw) return 'anonymous';
        try { return JSON.parse(raw)?.sub || 'anonymous'; } catch (_) { return 'anonymous'; }
    }

    function assertWebCryptoAvailable() {
        if (typeof crypto === 'undefined' || !crypto.subtle) {
            throw new Error('E2EE crypto is unavailable. Open the app via HTTPS or localhost. Mobile browsers usually block WebCrypto on plain http://LAN IP.');
        }
    }

    // ─── One-time migration: move username-scoped keys to unscoped ────────────
    // Runs once per page load. Safe to call multiple times.
    function migrateUsernameScoped() {
        const username = getCurrentUsername();
        if (!username || username === 'anonymous') return;
        [DEVICE_KEY_PREFIX, SESSION_KEY_PREFIX, DEVICE_ID_KEY_PREFIX].forEach(prefix => {
            const oldKey = `${prefix}:${username}`;
            const val = localStorage.getItem(oldKey);
            if (val !== null) {
                if (localStorage.getItem(prefix) === null) {
                    localStorage.setItem(prefix, val);
                }
                localStorage.removeItem(oldKey);
            }
        });
    }
    migrateUsernameScoped();

    // ─── WebCrypto wrappers ───────────────────────────────────────────────────

    async function exportRawPublicKey(publicKey) {
        assertWebCryptoAvailable();
        const raw = await crypto.subtle.exportKey('raw', publicKey);
        return bytesToB64(new Uint8Array(raw));
    }

    async function exportPkcs8PrivateKey(privateKey) {
        assertWebCryptoAvailable();
        const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
        return bytesToB64(new Uint8Array(pkcs8));
    }

    async function importRawPublicKey(base64) {
        assertWebCryptoAvailable();
        const raw = b64ToBytes(base64);
        return crypto.subtle.importKey('raw', raw, { name: 'X25519' }, true, []);
    }

    async function importPkcs8PrivateKey(base64) {
        assertWebCryptoAvailable();
        const pkcs8 = b64ToBytes(base64);
        return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, ['deriveBits']);
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

    async function deriveRootAndChainKey(inputKeyMaterial) {
        assertWebCryptoAvailable();
        const salt = new Uint8Array(32);
        const baseKey = await crypto.subtle.importKey('raw', inputKeyMaterial, { name: 'HKDF' }, false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('ChaosMessengerX3DH') },
            baseKey, 512
        );
        const arr = new Uint8Array(bits);
        return { rootKey: arr.slice(0, 32), chainKey: arr.slice(32, 64) };
    }

    async function ratchetStep(chainKeyBytes) {
        assertWebCryptoAvailable();
        const key = await crypto.subtle.importKey('raw', chainKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const mkBits   = await crypto.subtle.sign('HMAC', key, new Uint8Array([0x01]));
        const ckBits   = await crypto.subtle.sign('HMAC', key, new Uint8Array([0x02]));
        const mkRaw    = await crypto.subtle.importKey('raw', new Uint8Array(mkBits), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
        return { messageKey: mkRaw, nextChainKey: new Uint8Array(ckBits) };
    }

    async function aesEncryptWithKey(plainText, aesKey) {
        assertWebCryptoAvailable();
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plainText);
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, encoded);
        return { ciphertext: bytesToB64(new Uint8Array(ct)), nonce: bytesToB64(nonce) };
    }

    async function aesDecryptWithKey(ciphertextB64, nonceB64, aesKey) {
        assertWebCryptoAvailable();
        const ct    = b64ToBytes(ciphertextB64);
        const nonce = b64ToBytes(nonceB64);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ct);
        return new TextDecoder().decode(plain);
    }

    async function deriveSelfEnvelopeKey(localBundle) {
        assertWebCryptoAvailable();
        const raw = b64ToBytes(localBundle.identity.publicKey);
        const hkdfKey = await crypto.subtle.importKey('raw', raw, { name: 'HKDF' }, false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('ChaosMessengerSelf') },
            hkdfKey, 256
        );
        return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }

    async function encryptSelfEnvelope(localBundle, plainText) {
        const key = await deriveSelfEnvelopeKey(localBundle);
        return aesEncryptWithKey(plainText, key);
    }

    async function decryptSelfEnvelope(localBundle, envelope) {
        const key = await deriveSelfEnvelopeKey(localBundle);
        return aesDecryptWithKey(envelope.ciphertext, envelope.nonce, key);
    }

    // ─── Storage — NOT username-scoped ────────────────────────────────────────

    function getOrCreateDeviceId() {
        let id = localStorage.getItem(DEVICE_ID_KEY_PREFIX);
        if (!id) { id = 'device-' + safeUUID(); localStorage.setItem(DEVICE_ID_KEY_PREFIX, id); }
        return id;
    }

    function randomRegistrationId() {
        const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); return bytes[0] & 0x7fffffff;
    }

    function loadJson(key) {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    }

    function saveJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function getLocalDeviceBundle() { return loadJson(DEVICE_KEY_PREFIX); }
    function loadSessions()         { return loadJson(SESSION_KEY_PREFIX) || {}; }
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
        const deviceId = 'device-' + safeUUID();
        localStorage.setItem(DEVICE_ID_KEY_PREFIX, deviceId);
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

        const signingKeyPair = await crypto.subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
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
            signingPublicKey: bundle.signingKey?.publicKeySpki || null,
            signedPreKey: {
                preKeyId: bundle.signedPreKey.preKeyId,
                publicKey: bundle.signedPreKey.publicKey,
                signature: bundle.signedPreKey.signature
            },
            oneTimePreKeys: isNewDevice
                ? bundle.oneTimePreKeys.map(k => ({ preKeyId: k.preKeyId, publicKey: k.publicKey }))
                : []
        };
        log('[E2EE] registerBundleOnServer isNew=' + isNewDevice, 'deviceId=' + bundle.deviceId);
        await api('/api/crypto/devices/register', { method: 'POST', body: JSON.stringify(body) });
    }

    async function ensureDeviceRegistered(api) {
        const username = getCurrentUsername();
        const canRegister = !!(api && (api.__canRegisterDevice || api.canRegisterDevice));

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
                log('[E2EE] Legacy bundle without signingKey detected — recreating device');
                localStorage.removeItem(DEVICE_KEY_PREFIX);
                localStorage.removeItem(SESSION_KEY_PREFIX);
                bundle = await buildNewDeviceBundle();
                saveJson(DEVICE_KEY_PREFIX, bundle);
                shouldUploadOneTimeKeys = true;
            }

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
            _ephemeralPublicKey: ephemeralPublicKey,
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
            combined.set(dh1, 0); combined.set(dh2, dh1.length);
            combined.set(dh3, dh1.length + dh2.length); combined.set(dh4, dh1.length + dh2.length + dh3.length);
        } else {
            combined = new Uint8Array(dh1.length + dh2.length + dh3.length);
            combined.set(dh1, 0); combined.set(dh2, dh1.length); combined.set(dh3, dh1.length + dh2.length);
        }

        const keys = await deriveRootAndChainKey(combined);

        storeSession(localBundle.deviceId, envelope.senderDeviceId, {
            localDeviceId: localBundle.deviceId,
            remoteDeviceId: envelope.senderDeviceId,
            rootKey: bytesToB64(keys.rootKey),
            sendingChainStartKey: bytesToB64(keys.rootKey),
            sendingChainKey: null,
            sendingIndex: 0,
            receivingChainStartKey: bytesToB64(keys.chainKey),
            receivingChainKey: bytesToB64(keys.chainKey),
            receivingIndex: 0,
            senderIdentityPublicKey: envelope.senderIdentityPublicKey,
            establishedAt: Date.now(),
            version: 3
        });

        return keys;
    }

    // ─── Ratchet encrypt / decrypt ────────────────────────────────────────────

    async function encryptWithRatchet(session, plainText) {
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
        session.sendingChainKey = bytesToB64(nextChainKey);
        session.sendingIndex = (session.sendingIndex || 0) + 1;
        const encrypted = await aesEncryptWithKey(plainText, messageKey);
        return { encrypted, messageIndex: session.sendingIndex - 1 };
    }

    async function decryptWithRatchet(session, envelope) {
        const targetIndex = envelope.messageIndex ?? 0;
        let chainKeyBytes;

        if (!session.receivingChainStartKey) {
            session.receivingChainStartKey = session.receivingChainKey || session.rootKey;
        }
        if (!session.receivingChainKey) {
            chainKeyBytes = b64ToBytes(session.receivingChainStartKey);
            session.receivingChainKey = session.receivingChainStartKey;
            session.receivingIndex = 0;
        } else {
            chainKeyBytes = b64ToBytes(session.receivingChainKey);
        }

        let currentIndex = session.receivingIndex || 0;

        if (targetIndex < currentIndex) {
            chainKeyBytes = b64ToBytes(session.receivingChainStartKey);
            currentIndex = 0;
        }

        while (currentIndex < targetIndex) {
            const step = await ratchetStep(chainKeyBytes);
            chainKeyBytes = step.nextChainKey;
            currentIndex++;
        }

        const { messageKey, nextChainKey } = await ratchetStep(chainKeyBytes);

        if (targetIndex >= (session.receivingIndex || 0)) {
            session.receivingChainKey = bytesToB64(nextChainKey);
            session.receivingIndex = currentIndex + 1;
        }

        return aesDecryptWithKey(envelope.ciphertext, envelope.nonce, messageKey);
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

        if (envelope.messageType === 'PREKEY_WHISPER') {
            log('[decrypt] Bootstrap X3DH session with', envelope.senderDeviceId);
            await bootstrapRecipientSession(localBundle, envelope);
            session = getSession(localBundle.deviceId, envelope.senderDeviceId);
        }

        if (!session) {
            throw new Error('No session for device ' + envelope.senderDeviceId);
        }

        const plainText = await decryptWithRatchet(session, envelope);
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