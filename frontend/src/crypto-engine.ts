import {
    readSecureRecord,
    writeSecureRecord,
    writeSecureRecordsAtomic,
    deleteSecureRecord,
    clearSecureStorageForTests,
    secureStorageBackend
} from "./secure-storage.js";
import { buildEnvelopeAAD } from "./envelopeAad";
import type {
    AADContext,
    CryptoApi,
    CryptoEngine,
    DecryptEnvelope,
    DeviceBundle,
    DhRatchetKeyPair,
    EncryptedEnvelope,
    PreKey,
    RatchetSession,
    RemoteIdentityTrust,
    TargetDevice,
    TrustState,
    VerificationMethod
} from "./types/protocol";

type SessionMap = Record<string, RatchetSession>;
type TrustMap = Record<string, RemoteIdentityTrust>;

interface PrekeyPoolResponse {
    available?: unknown;
}

interface ResolveChatDevicesResponse {
    targetDevices?: TargetDevice[];
}

interface ReservePrekeyResponse {
    signedPreKey?: PreKey | null;
    oneTimePreKey?: PreKey | null;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return error == null ? '' : String(error);
}

function errorStatus(error: unknown): number {
    if (error && typeof error === 'object' && 'status' in error) {
        return Number((error as { status?: unknown }).status);
    }
    return Number.NaN;
}

function errorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
        return String((error as { code?: unknown }).code || '');
    }
    return '';
}

function cryptoSource(bytes: Uint8Array): BufferSource {
    return bytes as unknown as BufferSource;
}

async function createCryptoEngine(): Promise<CryptoEngine> {
    // ─── UUID helper — works in both secure (https/localhost) and non-secure (http+IP) contexts ───
    function safeUUID(): string {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = (crypto.getRandomValues(new Uint8Array(1))[0] ?? 0) % 16;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Chaos Messenger — Crypto Engine v4
    // Protocol: X3DH for session establishment + Double Ratchet for messages
    //
    // Double Ratchet (Signal specification):
    //   DH Ratchet — on every direction change a new X25519 keypair is generated,
    //     a DH exchange is performed, and new root + chain keys are derived.
    //     This provides break-in recovery: a compromised chain key is replaced
    //     after a single round-trip.
    //   Symmetric Ratchet — within each sending/receiving chain:
    //     nextChainKey  = HMAC-SHA256(chainKey, 0x02)
    //     messageKey    = HMAC-SHA256(chainKey, 0x01)
    //   KDF_RK(rootKey, dhOutput) — HKDF-SHA256 with rootKey as salt,
    //     dhOutput as IKM → 64 bytes split into newRootKey + newChainKey.
    // ─────────────────────────────────────────────────────────────────────────

    const DEVICE_KEY_PREFIX    = 'cm_device_bundle_v2';
    const SESSION_KEY_PREFIX   = 'cm_e2ee_sessions_v5';
    const DEVICE_ID_KEY_PREFIX = 'cm_device_id';
    const MAX_SKIP             = 2000;
    const MAX_STORED_SKIPPED_KEYS = 4000;

    let registrationPromise: Promise<DeviceBundle> | null = null;
    let registrationPromiseUsername: string | null = null;

    // ─── Base64 utilities ───────────────────────────────────────────────────────

    function b64ToBytes(base64: string): Uint8Array {
        return Uint8Array.from(atob(normalizeB64(base64)), c => c.charCodeAt(0));
    }

    function bytesToB64(bytes: Uint8Array): string {
        let binary = '';
        bytes.forEach(b => binary += String.fromCharCode(b));
        return btoa(binary);
    }

    function normalizeB64(value: unknown): string {
        if (value == null) return '';
        let text = String(value).trim().replace(/-/g, '+').replace(/_/g, '/');
        const pad = text.length % 4;
        if (pad) text += '='.repeat(4 - pad);
        return text;
    }

    function ratchetPublicKeyString(value: unknown): string {
        if (!value) return '';
        if (typeof value === 'object' && value !== null && 'publicKey' in value && (value as { publicKey?: unknown }).publicKey) {
            return String((value as { publicKey: unknown }).publicKey);
        }
        return String(value);
    }

    function publicKeysEqual(left: unknown, right: unknown): boolean {
        const a = ratchetPublicKeyString(left);
        const b = ratchetPublicKeyString(right);
        if (!a || !b) return false;
        if (a === b) return true;
        try {
            const ba = b64ToBytes(a);
            const bb = b64ToBytes(b);
            if (ba.length !== bb.length) return false;
            let diff = 0;
            for (let i = 0; i < ba.length; i++) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
            return diff === 0;
        } catch {
            return false;
        }
    }

    function toStandaloneAad(additionalData: ArrayBuffer | Uint8Array | null | undefined): Uint8Array | null {
        if (!additionalData || additionalData.byteLength === 0) return null;
        const view = additionalData instanceof Uint8Array
            ? additionalData
            : new Uint8Array(additionalData);
        return view.slice();
    }

    function b64ToArrayBuffer(base64: string): Uint8Array {
        return b64ToBytes(base64);
    }

    // ─── One-time migration: move legacy username-scoped keys to unscoped ────
    function migrateUsernameScoped() {
        [DEVICE_KEY_PREFIX, SESSION_KEY_PREFIX, DEVICE_ID_KEY_PREFIX].forEach(prefix => {
            const scopedKey = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
                .find(key => key?.startsWith(`${prefix}:`));
            if (!scopedKey) return;
            const value = localStorage.getItem(scopedKey);
            if (value !== null && localStorage.getItem(prefix) === null) {
                localStorage.setItem(prefix, value);
            }
            localStorage.removeItem(scopedKey);
        });
    }

    // ─── WebCrypto wrappers ───────────────────────────────────────────────────

    function assertWebCryptoAvailable() {
        if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.getRandomValues !== 'function') {
            throw new Error('WebCrypto is unavailable. Use HTTPS or localhost in a supported browser.');
        }
    }

    async function exportRawPublicKey(publicKey: CryptoKey): Promise<string> {
        assertWebCryptoAvailable();
        const raw = await crypto.subtle.exportKey('raw', publicKey);
        return bytesToB64(new Uint8Array(raw));
    }

    async function exportPkcs8PrivateKey(privateKey: CryptoKey): Promise<string> {
        assertWebCryptoAvailable();
        const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
        return bytesToB64(new Uint8Array(pkcs8));
    }

    async function importRawPublicKey(base64: string): Promise<CryptoKey> {
        assertWebCryptoAvailable();
        const raw = b64ToBytes(base64);
        return crypto.subtle.importKey('raw', cryptoSource(raw), { name: 'X25519' }, true, []);
    }

    async function importPkcs8PrivateKey(base64: string): Promise<CryptoKey> {
        assertWebCryptoAvailable();
        const pkcs8 = b64ToBytes(base64);
        return crypto.subtle.importKey('pkcs8', cryptoSource(pkcs8), { name: 'X25519' }, true, ['deriveBits']);
    }

    async function generateX25519KeyPair(): Promise<CryptoKeyPair> {
        assertWebCryptoAvailable();
        const generated = await crypto.subtle.generateKey(
            { name: 'X25519' },
            true,
            ['deriveBits']
        );
        if (!('publicKey' in generated) || !('privateKey' in generated)) {
            throw new Error('X25519 key generation did not return a key pair');
        }
        return generated;
    }

    async function derive32(privateKey: CryptoKey, publicKey: CryptoKey): Promise<Uint8Array> {
        assertWebCryptoAvailable();
        const bits = await crypto.subtle.deriveBits({ name: 'X25519', public: publicKey }, privateKey, 256);
        return new Uint8Array(bits);
    }

    // ─── KDF functions ────────────────────────────────────────────────────────

    async function deriveInitialRootAndChainKey(inputKeyMaterial: Uint8Array): Promise<{ rootKey: Uint8Array; chainKey: Uint8Array }> {
        assertWebCryptoAvailable();
        const salt = new Uint8Array(32);
        const baseKey = await crypto.subtle.importKey('raw', cryptoSource(inputKeyMaterial), { name: 'HKDF' }, false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('ChaosMessengerX3DH') },
            baseKey, 512
        );
        const arr = new Uint8Array(bits);
        return { rootKey: arr.slice(0, 32), chainKey: arr.slice(32, 64) };
    }

    async function kdfRK(rootKeyBytes: Uint8Array, dhOutputBytes: Uint8Array): Promise<{ rootKey: Uint8Array; chainKey: Uint8Array }> {
        assertWebCryptoAvailable();
        const baseKey = await crypto.subtle.importKey('raw', cryptoSource(dhOutputBytes), { name: 'HKDF' }, false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt: cryptoSource(rootKeyBytes), info: new TextEncoder().encode('ChaosDoubleRatchet') },
            baseKey, 512
        );
        const arr = new Uint8Array(bits);
        return { rootKey: arr.slice(0, 32), chainKey: arr.slice(32, 64) };
    }

    async function ratchetStep(chainKeyBytes: Uint8Array): Promise<{ messageKeyRaw: Uint8Array; nextChainKey: Uint8Array }> {
        assertWebCryptoAvailable();
        const key = await crypto.subtle.importKey('raw', cryptoSource(chainKeyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const mkBits = new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array([0x01])));
        const ckBits = new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array([0x02])));
        return { messageKeyRaw: mkBits, nextChainKey: ckBits };
    }

    async function importMessageKey(rawBytes: Uint8Array): Promise<CryptoKey> {
        assertWebCryptoAvailable();
        return crypto.subtle.importKey('raw', cryptoSource(rawBytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }

    // ─── AES-GCM encrypt / decrypt ───────────────────────────────────────────

    async function aesEncryptWithKey(plainText: string, aesKey: CryptoKey, additionalData: ArrayBuffer | Uint8Array | null = null) {
        assertWebCryptoAvailable();
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plainText);
        const params: AesGcmParams = { name: 'AES-GCM', iv: cryptoSource(nonce) };
        const aad = toStandaloneAad(additionalData);
        if (aad) params.additionalData = cryptoSource(aad);
        const ct = await crypto.subtle.encrypt(params, aesKey, encoded);
        return { ciphertext: bytesToB64(new Uint8Array(ct)), nonce: bytesToB64(nonce) };
    }

    async function aesDecryptWithKey(ciphertextB64: string, nonceB64: string, aesKey: CryptoKey, additionalData: ArrayBuffer | Uint8Array | null = null): Promise<string> {
        assertWebCryptoAvailable();
        const ct    = b64ToBytes(ciphertextB64);
        const nonce = b64ToBytes(nonceB64);
        const params: AesGcmParams = { name: 'AES-GCM', iv: cryptoSource(nonce) };
        const aad = toStandaloneAad(additionalData);
        if (aad) params.additionalData = cryptoSource(aad);
        const plain = await crypto.subtle.decrypt(params, aesKey, cryptoSource(ct));
        return new TextDecoder().decode(plain);
    }

    // ─── Self-envelope encryption (for cross-device sync) ─────────────────────

    async function deriveSelfEnvelopeKey(localBundle: DeviceBundle): Promise<CryptoKey> {
        assertWebCryptoAvailable();
        if (!localBundle?.identity?.privateKeyPkcs8) {
            throw new Error('Local private identity key is missing');
        }
        const raw = b64ToBytes(localBundle.identity.privateKeyPkcs8);
        const seed = new Uint8Array(await crypto.subtle.digest('SHA-256', cryptoSource(raw)));
        const saltInput = new TextEncoder().encode(localBundle.deviceId || 'unknown-device');
        const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', saltInput));
        const hkdfKey = await crypto.subtle.importKey('raw', cryptoSource(seed), { name: 'HKDF' }, false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt: cryptoSource(salt), info: new TextEncoder().encode('ChaosMessengerSelf:v2') },
            hkdfKey, 256
        );
        return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }

    async function encryptSelfEnvelope(localBundle: DeviceBundle, plainText: string) {
        const key = await deriveSelfEnvelopeKey(localBundle);
        return aesEncryptWithKey(plainText, key);
    }

    async function decryptSelfEnvelope(localBundle: DeviceBundle, envelope: { ciphertext: string; nonce: string }): Promise<string> {
        const key = await deriveSelfEnvelopeKey(localBundle);
        return aesDecryptWithKey(envelope.ciphertext, envelope.nonce, key);
    }

    // ─── Secure storage ───────────────────────────────────────────────────────

    const DEVICE_RECORD = 'device-bundle-v1';
    const SESSION_RECORD = 'ratchet-sessions-v1';
    const TRUST_RECORD = 'identity-trust-v1';
    const PREKEY_REPLENISH_THRESHOLD = 20;
    const PREKEY_TARGET_COUNT = 50;
    const SIGNED_PREKEY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

    let localDeviceBundle: DeviceBundle | null = null;
    let sessionState: SessionMap = {};
    let identityTrustState: TrustMap = {};
    const inProcessLocks = new Map<string, Promise<unknown>>();

    function getOrCreateDeviceId() {
        let id = localStorage.getItem(DEVICE_ID_KEY_PREFIX);
        if (!id) { id = 'device-' + safeUUID(); localStorage.setItem(DEVICE_ID_KEY_PREFIX, id); }
        return id;
    }

    function randomRegistrationId() {
        const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); return (bytes[0] ?? 0) & 0x7fffffff;
    }

    function loadLegacyJson(key: string): unknown {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    async function initializeSecureState() {
        migrateUsernameScoped();

        const legacyBundle = loadLegacyJson(DEVICE_KEY_PREFIX);
        const legacySessions = loadLegacyJson(SESSION_KEY_PREFIX);

        localDeviceBundle = (await readSecureRecord(DEVICE_RECORD) as DeviceBundle | null) || null;
        sessionState = (await readSecureRecord(SESSION_RECORD) as SessionMap | null) || {};
        identityTrustState = (await readSecureRecord(TRUST_RECORD) as TrustMap | null) || {};

        if (!localDeviceBundle && legacyBundle) {
            localDeviceBundle = legacyBundle as DeviceBundle;
            await writeSecureRecord(DEVICE_RECORD, legacyBundle);
        }
        if (Object.keys(sessionState).length === 0 && legacySessions) {
            sessionState = legacySessions as SessionMap;
            await writeSecureRecord(SESSION_RECORD, legacySessions);
        }

        // Private key material and ratchet state must never remain in localStorage.
        localStorage.removeItem(DEVICE_KEY_PREFIX);
        localStorage.removeItem(SESSION_KEY_PREFIX);
    }

    async function reloadSecureState() {
        localDeviceBundle = (await readSecureRecord(DEVICE_RECORD) as DeviceBundle | null) || localDeviceBundle;
        sessionState = (await readSecureRecord(SESSION_RECORD) as SessionMap | null) || {};
        identityTrustState = (await readSecureRecord(TRUST_RECORD) as TrustMap | null) || {};
    }

    function getLocalDeviceBundle() {
        return localDeviceBundle ? structuredClone(localDeviceBundle) : null;
    }

    async function saveLocalDeviceBundle(bundle: DeviceBundle): Promise<void> {
        localDeviceBundle = structuredClone(bundle);
        await writeSecureRecord(DEVICE_RECORD, localDeviceBundle);
    }

    function loadSessions(): SessionMap {
        return structuredClone(sessionState || {});
    }

    async function saveSessions(sessions: SessionMap): Promise<void> {
        sessionState = structuredClone(sessions || {});
        await writeSecureRecord(SESSION_RECORD, sessionState);
    }

    async function resetLocalDeviceIdentity() {
        localDeviceBundle = null;
        sessionState = {};
        identityTrustState = {};
        localStorage.removeItem(DEVICE_KEY_PREFIX);
        localStorage.removeItem(SESSION_KEY_PREFIX);
        localStorage.removeItem(DEVICE_ID_KEY_PREFIX);
        await Promise.all([
            deleteSecureRecord(DEVICE_RECORD),
            deleteSecureRecord(SESSION_RECORD),
            deleteSecureRecord(TRUST_RECORD)
        ]);
        registrationPromise = null;
        registrationPromiseUsername = null;
        log('[E2EE] Local device identity reset');
    }

    async function importLocalDeviceBundle(bundle: DeviceBundle): Promise<string> {
        if (!bundle?.deviceId || !bundle?.identity?.publicKey || !bundle?.identity?.privateKeyPkcs8) {
            throw new Error('Backup does not contain a valid device identity');
        }
        localStorage.setItem(DEVICE_ID_KEY_PREFIX, bundle.deviceId);
        localDeviceBundle = structuredClone(bundle);
        sessionState = {};
        await Promise.all([
            writeSecureRecord(DEVICE_RECORD, localDeviceBundle),
            writeSecureRecord(SESSION_RECORD, sessionState)
        ]);
        localStorage.removeItem(DEVICE_KEY_PREFIX);
        localStorage.removeItem(SESSION_KEY_PREFIX);
        registrationPromise = null;
        registrationPromiseUsername = null;
        return bundle.deviceId;
    }

    function sessionKey(localDeviceId: string, remoteDeviceId: string): string {
        return `device:${localDeviceId}:remote:${remoteDeviceId}`;
    }

    function getSession(localDeviceId: string, remoteDeviceId: string): RatchetSession | null {
        const value = sessionState[sessionKey(localDeviceId, remoteDeviceId)];
        return value ? structuredClone(value) : null;
    }

    async function storeSession(localDeviceId: string, remoteDeviceId: string, session: RatchetSession): Promise<void> {
        const sessions = loadSessions();
        sessions[sessionKey(localDeviceId, remoteDeviceId)] = structuredClone(session);
        await saveSessions(sessions);
    }

    async function commitRecipientBootstrap(localBundle: DeviceBundle, remoteDeviceId: string, session: RatchetSession, consumedPreKeyId: number | null | undefined): Promise<void> {
        if (consumedPreKeyId == null) {
            throw new Error('One-time prekey is required to establish a session');
        }
        const nextBundle = structuredClone(localBundle);
        const before = nextBundle.oneTimePreKeys?.length || 0;
        nextBundle.oneTimePreKeys = (nextBundle.oneTimePreKeys || [])
            .filter(key => key.preKeyId !== consumedPreKeyId);
        if ((nextBundle.oneTimePreKeys?.length || 0) === before) {
            throw new Error('One-time prekey was already consumed: ' + consumedPreKeyId);
        }

        const nextSessions = loadSessions();
        nextSessions[sessionKey(nextBundle.deviceId, remoteDeviceId)] = structuredClone(session);
        await writeSecureRecordsAtomic({
            [DEVICE_RECORD]: nextBundle,
            [SESSION_RECORD]: nextSessions
        });
        localDeviceBundle = nextBundle;
        sessionState = nextSessions;
    }

    async function withInProcessLock<T>(name: string, operation: () => Promise<T>): Promise<T> {
        const previous = inProcessLocks.get(name) || Promise.resolve();
        let release: (() => void) | undefined;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const tail = previous.then(() => gate);
        inProcessLocks.set(name, tail);
        await previous;
        try {
            return await operation();
        } finally {
            release?.();
            if (inProcessLocks.get(name) === tail) inProcessLocks.delete(name);
        }
    }

    async function withCryptoStateLock<T>(operation: () => Promise<T>): Promise<T> {
        const run = async () => {
            await reloadSecureState();
            return operation();
        };
        if (typeof navigator !== 'undefined' && navigator.locks?.request) {
            return navigator.locks.request('chaos-messenger-ratchet-state-v1', { mode: 'exclusive' }, run);
        }
        return withInProcessLock('ratchet-state', run);
    }

    function trustKey(remoteDeviceId: string): string {
        return `device:${remoteDeviceId}`;
    }

    async function observeRemoteIdentity(remoteDeviceId: string, identityPublicKey: string): Promise<TrustState> {
        if (!remoteDeviceId || !identityPublicKey) return 'UNVERIFIED';
        const key = trustKey(remoteDeviceId);
        const current = identityTrustState[key];
        if (!current) {
            identityTrustState[key] = {
                identityPublicKey,
                trustState: 'UNVERIFIED',
                firstSeenAt: Date.now(),
                lastSeenAt: Date.now()
            };
            await writeSecureRecord(TRUST_RECORD, identityTrustState);
            return 'UNVERIFIED';
        }
        if (current.trustState === 'BLOCKED') {
            if (current.identityPublicKey !== identityPublicKey) {
                current.previousIdentityPublicKey = current.identityPublicKey;
                current.identityPublicKey = identityPublicKey;
                current.changedAt = Date.now();
            }
            current.lastSeenAt = Date.now();
            await writeSecureRecord(TRUST_RECORD, identityTrustState);
            return 'BLOCKED';
        }
        if (current.identityPublicKey !== identityPublicKey) {
            current.previousIdentityPublicKey = current.identityPublicKey;
            current.identityPublicKey = identityPublicKey;
            current.trustState = 'KEY_CHANGED';
            current.changedAt = Date.now();
            current.lastSeenAt = Date.now();
            await writeSecureRecord(TRUST_RECORD, identityTrustState);
            return 'KEY_CHANGED';
        }
        current.lastSeenAt = Date.now();
        return current.trustState || 'UNVERIFIED';
    }

    async function verifyRemoteIdentity(
        remoteDeviceId: string,
        identityPublicKey: string,
        method: VerificationMethod = 'MANUAL'
    ): Promise<void> {
        if (!remoteDeviceId || !identityPublicKey) throw new Error('Remote device identity is required');
        identityTrustState[trustKey(remoteDeviceId)] = {
            identityPublicKey,
            trustState: 'VERIFIED',
            verificationMethod: method,
            verifiedAt: Date.now(),
            firstSeenAt: identityTrustState[trustKey(remoteDeviceId)]?.firstSeenAt || Date.now(),
            lastSeenAt: Date.now()
        };
        await writeSecureRecord(TRUST_RECORD, identityTrustState);
    }

    async function blockRemoteIdentity(remoteDeviceId: string, identityPublicKey: string): Promise<void> {
        if (!remoteDeviceId || !identityPublicKey) throw new Error('Remote device identity is required');
        const previous = identityTrustState[trustKey(remoteDeviceId)];
        identityTrustState[trustKey(remoteDeviceId)] = {
            identityPublicKey,
            trustState: 'BLOCKED',
            firstSeenAt: previous?.firstSeenAt || Date.now(),
            lastSeenAt: Date.now(),
            changedAt: Date.now(),
            ...(previous?.identityPublicKey ? { previousIdentityPublicKey: previous.identityPublicKey } : {})
        };
        await writeSecureRecord(TRUST_RECORD, identityTrustState);
    }

    function getRemoteIdentityTrust(remoteDeviceId: string, identityPublicKey: string | null = null): RemoteIdentityTrust {
        const current = identityTrustState[trustKey(remoteDeviceId)];
        if (!current) return { trustState: 'UNVERIFIED', identityPublicKey: identityPublicKey ?? '' };
        if (current.trustState === 'BLOCKED') return structuredClone(current);
        if (identityPublicKey && current.identityPublicKey !== identityPublicKey) {
            return { ...structuredClone(current), trustState: 'KEY_CHANGED', identityPublicKey };
        }
        return structuredClone(current);
    }

    // ─── Device bundle generation and registration ───────────────────────────

    async function generateOneTimePreKeys(count: number, startAt = 1000): Promise<PreKey[]> {
        const generated: PreKey[] = [];
        for (let i = 0; i < count; i++) {
            const kp = await generateX25519KeyPair();
            generated.push({
                preKeyId: startAt + i,
                publicKey: await exportRawPublicKey(kp.publicKey),
                privateKeyPkcs8: await exportPkcs8PrivateKey(kp.privateKey),
                published: false
            });
        }
        return generated;
    }

    async function createSignedPreKeyRecord(signingPrivatePkcs8: string, preKeyId: number): Promise<PreKey> {
        const signedPreKey = await generateX25519KeyPair();
        const publicKey = await exportRawPublicKey(signedPreKey.publicKey);
        const signingKey = await crypto.subtle.importKey(
            'pkcs8',
            cryptoSource(b64ToBytes(signingPrivatePkcs8)),
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['sign']
        );
        const signatureBuf = await crypto.subtle.sign(
            { name: 'ECDSA', hash: { name: 'SHA-256' } },
            signingKey,
            cryptoSource(b64ToBytes(publicKey))
        );
        return {
            preKeyId,
            publicKey,
            privateKeyPkcs8: await exportPkcs8PrivateKey(signedPreKey.privateKey),
            signature: bytesToB64(new Uint8Array(signatureBuf)),
            createdAt: Date.now()
        };
    }

    function signedPreKeyForEnvelope(bundle: DeviceBundle, signedPreKeyId: number | null | undefined): PreKey {
        if (signedPreKeyId != null && bundle.previousSignedPreKey?.preKeyId === signedPreKeyId) {
            return bundle.previousSignedPreKey;
        }
        return bundle.signedPreKey;
    }

    async function rotateSignedPreKeyIfNeeded(api: CryptoApi, bundle: DeviceBundle): Promise<DeviceBundle> {
        const createdAt = Number(bundle.signedPreKey?.createdAt || 0);
        if (!createdAt) {
            const stamped = structuredClone(bundle);
            stamped.signedPreKey = { ...stamped.signedPreKey, createdAt: Date.now() };
            await saveLocalDeviceBundle(stamped);
            return stamped;
        }
        if ((Date.now() - createdAt) < SIGNED_PREKEY_MAX_AGE_MS) {
            return bundle;
        }
        if (!bundle.signingKey?.privateKeyPkcs8) return bundle;
        const nextId = Math.max(1, Number(bundle.signedPreKey?.preKeyId || 1)) + 1;
        const rotated = await createSignedPreKeyRecord(bundle.signingKey.privateKeyPkcs8, nextId);
        const nextBundle: DeviceBundle = {
            ...structuredClone(bundle),
            previousSignedPreKey: bundle.signedPreKey,
            signedPreKey: rotated
        };
        await saveLocalDeviceBundle(nextBundle);
        await registerBundleOnServer(api, nextBundle, false);
        return nextBundle;
    }

    async function buildNewDeviceBundle() {
        const deviceId = 'device-' + safeUUID();
        localStorage.setItem(DEVICE_ID_KEY_PREFIX, deviceId);
        log('[E2EE] New deviceId:', deviceId);
        const registrationId = randomRegistrationId();
        const identity = await generateX25519KeyPair();
        const oneTimePreKeys = await generateOneTimePreKeys(PREKEY_TARGET_COUNT, 1000);
        const identityPrivate     = await exportPkcs8PrivateKey(identity.privateKey);
        const identityPublic      = await exportRawPublicKey(identity.publicKey);

        const signingKeyPair = await crypto.subtle.generateKey(
            { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
        );
        const signingPublicKeySpki = await crypto.subtle.exportKey('spki', signingKeyPair.publicKey);
        const signingPublicKey     = bytesToB64(new Uint8Array(signingPublicKeySpki));
        const signingPrivateKeyPkcs8Raw = await crypto.subtle.exportKey('pkcs8', signingKeyPair.privateKey);
        const signingPrivateKeyPkcs8    = bytesToB64(new Uint8Array(signingPrivateKeyPkcs8Raw));
        const signedPreKeyRecord = await createSignedPreKeyRecord(signingPrivateKeyPkcs8, 1);

        return {
            deviceId, registrationId,
            identity: { publicKey: identityPublic, privateKeyPkcs8: identityPrivate },
            signingKey: { publicKeySpki: signingPublicKey, privateKeyPkcs8: signingPrivateKeyPkcs8 },
            signedPreKey: signedPreKeyRecord,
            oneTimePreKeys
        };
    }

    function log(...args: unknown[]): void {
        if (import.meta.env.DEV) console.warn('[ChaosMessenger]', ...args);
    }

    async function registerBundleOnServer(api: CryptoApi, bundle: DeviceBundle, isNewDevice = false): Promise<void> {
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

    async function replenishOneTimePreKeys(api: CryptoApi): Promise<DeviceBundle | null> {
        if (!api || !localDeviceBundle) return localDeviceBundle;

        await rotateSignedPreKeyIfNeeded(api, localDeviceBundle);

        const serverPool = await api('/api/crypto/devices/current/prekeys', { method: 'GET' }) as PrekeyPoolResponse;
        const serverAvailable = Math.max(0, Number(serverPool?.available || 0));
        let nextBundle = structuredClone(localDeviceBundle);
        let unpublished = (nextBundle.oneTimePreKeys || []).filter(key => key.published === false);

        if (serverAvailable + unpublished.length < PREKEY_REPLENISH_THRESHOLD) {
            const existingIds = (nextBundle.oneTimePreKeys || []).map(key => Number(key.preKeyId) || 0);
            const startAt = Math.max(1000, ...existingIds) + 1;
            const needed = PREKEY_TARGET_COUNT - serverAvailable - unpublished.length;
            const generated = await generateOneTimePreKeys(Math.max(0, needed), startAt);
            nextBundle.oneTimePreKeys = [...(nextBundle.oneTimePreKeys || []), ...generated];
            await saveLocalDeviceBundle(nextBundle);
            unpublished = [...unpublished, ...generated];
        }

        if (unpublished.length > 0) {
            await api('/api/crypto/devices/current/prekeys', {
                method: 'POST',
                body: JSON.stringify({
                    oneTimePreKeys: unpublished.map(key => ({
                        preKeyId: key.preKeyId,
                        publicKey: key.publicKey
                    }))
                })
            });
            const uploadedIds = new Set(unpublished.map(key => key.preKeyId));
            nextBundle = structuredClone(localDeviceBundle);
            nextBundle.oneTimePreKeys = (nextBundle.oneTimePreKeys || []).map(key =>
                uploadedIds.has(key.preKeyId) ? { ...key, published: true } : key
            );
            await saveLocalDeviceBundle(nextBundle);
        }
        return getLocalDeviceBundle();
    }

    function isRevokedDeviceError(error: unknown): boolean {
        const code = errorCode(error);
        if (code === "DEVICE_REVOKED") return true;
        return /revoked|inactive|active device not found/i.test(errorMessage(error));
    }

    function isMissingServerDeviceError(error: unknown): boolean {
        if (isRevokedDeviceError(error)) return false;
        const status = errorStatus(error);
        if (status === 404) return true;
        return /not registered/i.test(errorMessage(error));
    }

    async function ensureDeviceRegistered(api: CryptoApi): Promise<DeviceBundle> {
        const registrationScope = getOrCreateDeviceId();

        if (registrationPromise && registrationPromiseUsername === registrationScope) return registrationPromise;
        registrationPromiseUsername = registrationScope;

        registrationPromise = (async () => {
            let bundle = getLocalDeviceBundle();
            let shouldUploadOneTimeKeys = false;

            if (!bundle) {
                log('[E2EE] New device — generating keys');
                bundle = await buildNewDeviceBundle();
                await saveLocalDeviceBundle(bundle);
                shouldUploadOneTimeKeys = true;
            } else if (!bundle?.signingKey?.publicKeySpki) {
                log('[E2EE] Legacy bundle without signingKey detected — recreating device');
                localStorage.removeItem(DEVICE_KEY_PREFIX);
                localStorage.removeItem(SESSION_KEY_PREFIX);
                bundle = await buildNewDeviceBundle();
                await saveLocalDeviceBundle(bundle);
                shouldUploadOneTimeKeys = true;
            }

            if (shouldUploadOneTimeKeys) {
                await registerBundleOnServer(api, bundle, true);
                bundle = structuredClone(bundle);
                bundle.oneTimePreKeys = (bundle.oneTimePreKeys || []).map(key => ({ ...key, published: true }));
                await saveLocalDeviceBundle(bundle);
            } else {
                log('[E2EE] Existing device detected, skipping re-registration:', bundle.deviceId);
                try {
                    await replenishOneTimePreKeys(api);
                } catch (error) {
                    if (!isMissingServerDeviceError(error)) throw error;
                    log('[E2EE] Local device is missing on server, registering:', bundle.deviceId);
                    await registerBundleOnServer(api, bundle, true);
                    bundle = structuredClone(bundle);
                    bundle.oneTimePreKeys = (bundle.oneTimePreKeys || []).map(key => ({ ...key, published: true }));
                    await saveLocalDeviceBundle(bundle);
                }
                bundle = getLocalDeviceBundle();
                if (!bundle) throw new Error('Local device bundle is missing');
            }
            return bundle;
        })().catch((err: unknown) => {
            registrationPromise = null;
            registrationPromiseUsername = null;
            throw err;
        });
        return registrationPromise;
    }

    // ─── Signed prekey verification ──────────────────────────────────────────

    async function verifySignedPreKeySignature(signingPublicKeyB64: string | null | undefined, signedPreKeyPublicB64: string | null | undefined, signatureB64: string | null | undefined): Promise<void> {
        if (!signingPublicKeyB64 || !signedPreKeyPublicB64 || !signatureB64) {
            throw new Error('Target device signed prekey bundle is incomplete');
        }
        assertWebCryptoAvailable();
        const signingKey = await crypto.subtle.importKey(
            'spki',
            cryptoSource(b64ToArrayBuffer(signingPublicKeyB64)),
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        );
        const verified = await crypto.subtle.verify(
            { name: 'ECDSA', hash: { name: 'SHA-256' } },
            signingKey,
            cryptoSource(b64ToBytes(signatureB64)),
            cryptoSource(b64ToBytes(signedPreKeyPublicB64))
        );
        if (!verified) {
            throw new Error('Invalid signed prekey signature');
        }
    }

    // ─── Helper: serialize/deserialize DH ratchet keypair ────────────────────

    async function exportDHKeyPair(keyPair: CryptoKeyPair): Promise<DhRatchetKeyPair> {
        return {
            publicKey: await exportRawPublicKey(keyPair.publicKey),
            privateKeyPkcs8: await exportPkcs8PrivateKey(keyPair.privateKey)
        };
    }

    // ─── X3DH + Double Ratchet session establishment (initiator) ─────────────

    async function createInitiatorSession(localBundle: DeviceBundle, targetDevice: TargetDevice): Promise<{ session: RatchetSession; ephemeralPublicKey: string }> {
        await verifySignedPreKeySignature(
            targetDevice.signingPublicKey,
            targetDevice.signedPreKey?.publicKey,
            targetDevice.signedPreKey?.signature
        );

        const identityPrivate       = await importPkcs8PrivateKey(localBundle.identity.privateKeyPkcs8);
        const ephemeral             = await generateX25519KeyPair();
        const ephemeralPublicKey    = await exportRawPublicKey(ephemeral.publicKey);
        const remoteIdentityPub     = await importRawPublicKey(targetDevice.identityPublicKey);
        const signedPreKey = targetDevice.signedPreKey;
        if (!signedPreKey?.publicKey) {
            throw new Error('Target device signed prekey bundle is incomplete');
        }
        const remoteSignedPreKeyPub = await importRawPublicKey(signedPreKey.publicKey);

        // X3DH DH calculations
        const dh1 = await derive32(identityPrivate, remoteSignedPreKeyPub);
        const dh2 = await derive32(ephemeral.privateKey, remoteIdentityPub);
        const dh3 = await derive32(ephemeral.privateKey, remoteSignedPreKeyPub);

        let combined;
        if (!targetDevice.oneTimePreKey?.publicKey) {
            throw new Error('ONE_TIME_PREKEY_EXHAUSTED:' + targetDevice.deviceId);
        }
        const remoteOneTimePub = await importRawPublicKey(targetDevice.oneTimePreKey.publicKey);
        const dh4 = await derive32(ephemeral.privateKey, remoteOneTimePub);
        combined = new Uint8Array(dh1.length + dh2.length + dh3.length + dh4.length);
        combined.set(dh1, 0); combined.set(dh2, dh1.length);
        combined.set(dh3, dh1.length + dh2.length); combined.set(dh4, dh1.length + dh2.length + dh3.length);

        const initial = await deriveInitialRootAndChainKey(combined);
        const SK = initial.rootKey;

        // Double Ratchet initialization (initiator / Alice role):
        // Generate first DH ratchet keypair, use recipient's signed prekey as DHr.
        const DHs = await generateX25519KeyPair();
        const DHsExported = await exportDHKeyPair(DHs);
        const DHr = signedPreKey.publicKey;

        const remoteSignedPub = await importRawPublicKey(DHr);
        const dhResult = await derive32(DHs.privateKey, remoteSignedPub);
        const { rootKey, chainKey: CKs } = await kdfRK(SK, dhResult);

        const session = {
            localDeviceId: localBundle.deviceId,
            remoteDeviceId: targetDevice.deviceId,
            RK: bytesToB64(rootKey),
            DHs: DHsExported,
            DHr: DHr,
            CKs: bytesToB64(CKs),
            CKr: null,
            Ns: 0,
            Nr: 0,
            PN: 0,
            MKSKIPPED: {},
            senderIdentityPublicKey: localBundle.identity.publicKey,
            _ephemeralPublicKey: ephemeralPublicKey,
            establishedAt: Date.now(),
            version: 4
        };

        await storeSession(localBundle.deviceId, targetDevice.deviceId, session);
        return { session, ephemeralPublicKey };
    }

    // ─── X3DH + Double Ratchet session establishment (recipient) ─────────────

    async function bootstrapRecipientSession(localBundle: DeviceBundle, envelope: DecryptEnvelope): Promise<RatchetSession> {
        const identityPrivate      = await importPkcs8PrivateKey(localBundle.identity.privateKeyPkcs8);
        const usedSignedPreKey     = signedPreKeyForEnvelope(localBundle, envelope.signedPreKeyId);
        const signedPreKeyPrivate  = await importPkcs8PrivateKey(usedSignedPreKey.privateKeyPkcs8);
        if (!envelope.senderIdentityPublicKey || !envelope.ephemeralPublicKey) {
            throw new Error('PREKEY_WHISPER is missing handshake public keys');
        }
        const senderIdentityPub    = await importRawPublicKey(envelope.senderIdentityPublicKey);
        const ephemeralPub         = await importRawPublicKey(envelope.ephemeralPublicKey);

        // X3DH DH calculations (recipient / Bob role)
        const dh1 = await derive32(signedPreKeyPrivate, senderIdentityPub);
        const dh2 = await derive32(identityPrivate, ephemeralPub);
        const dh3 = await derive32(signedPreKeyPrivate, ephemeralPub);

        let combined;
        if (envelope.oneTimePreKeyId == null) {
            throw new Error('One-time prekey is required to establish a session');
        }
        const oneTime = localBundle.oneTimePreKeys.find(k => k.preKeyId === envelope.oneTimePreKeyId);
        if (!oneTime) throw new Error('One-time prekey not found locally: ' + envelope.oneTimePreKeyId);
        const oneTimePrivate = await importPkcs8PrivateKey(oneTime.privateKeyPkcs8);
        const dh4 = await derive32(oneTimePrivate, ephemeralPub);
        combined = new Uint8Array(dh1.length + dh2.length + dh3.length + dh4.length);
        combined.set(dh1, 0); combined.set(dh2, dh1.length);
        combined.set(dh3, dh1.length + dh2.length); combined.set(dh4, dh1.length + dh2.length + dh3.length);

        const initial = await deriveInitialRootAndChainKey(combined);
        const SK = initial.rootKey;

        // Double Ratchet initialization (recipient / Bob role):
        // DHs = signed prekey pair; DHr is unknown until first message arrives.
        // The first decryptWithDoubleRatchet call will perform the DH ratchet step.
        const session = {
            localDeviceId: localBundle.deviceId,
            remoteDeviceId: envelope.senderDeviceId,
            RK: bytesToB64(SK),
            DHs: {
                publicKey: usedSignedPreKey.publicKey,
                privateKeyPkcs8: usedSignedPreKey.privateKeyPkcs8
            },
            DHr: null,
            CKs: null,
            CKr: null,
            Ns: 0,
            Nr: 0,
            PN: 0,
            MKSKIPPED: {},
            senderIdentityPublicKey: envelope.senderIdentityPublicKey,
            establishedAt: Date.now(),
            version: 4
        };

        return session;
    }

    // ─── Double Ratchet core ─────────────────────────────────────────────────

    function skippedKeyId(dhPub: unknown, n: number): string {
        return normalizeB64(ratchetPublicKeyString(dhPub)) + ':' + n;
    }

    async function decryptCiphertextWithEnvelopeAad(ciphertext: string, nonce: string, aesKey: CryptoKey, envelope: DecryptEnvelope): Promise<string> {
        if (envelope._chatId == null) {
            throw new Error('Envelope is missing chat binding');
        }
        const aad = buildEnvelopeAAD({
            messageType: envelope.messageType,
            chatId: envelope._chatId,
            messageIndex: envelope.messageIndex ?? 0,
            previousChainLength: envelope.previousChainLength ?? 0,
            ratchetPublicKey: envelope.ratchetPublicKey
        });
        return aesDecryptWithKey(ciphertext, nonce, aesKey, aad);
    }

    async function trySkippedMessageKeys(session: RatchetSession, envelope: DecryptEnvelope): Promise<string | null> {
        const kid = skippedKeyId(envelope.ratchetPublicKey, envelope.messageIndex ?? 0);
        const mkRawB64 = session.MKSKIPPED[kid];
        if (!mkRawB64) return null;
        const mk = await importMessageKey(b64ToBytes(mkRawB64));
        const plainText = await decryptCiphertextWithEnvelopeAad(
            envelope.ciphertext, envelope.nonce, mk, envelope
        );
        delete session.MKSKIPPED[kid];
        return plainText;
    }

    async function skipMessageKeys(session: RatchetSession, until: number): Promise<void> {
        if (session.CKr == null) return;
        if ((until - (session.Nr || 0)) > MAX_SKIP) {
            throw new Error('Too many skipped messages: ' + (until - (session.Nr || 0)));
        }
        let ckBytes = b64ToBytes(session.CKr);
        let nr = session.Nr || 0;
        while (nr < until) {
            const { messageKeyRaw, nextChainKey } = await ratchetStep(ckBytes);
            session.MKSKIPPED[skippedKeyId(session.DHr, nr)] = bytesToB64(messageKeyRaw);
            ckBytes = nextChainKey;
            nr++;
        }
        session.CKr = bytesToB64(ckBytes);
        session.Nr = nr;
        pruneSkippedKeys(session);
    }

    function pruneSkippedKeys(session: RatchetSession): void {
        const keys = Object.keys(session.MKSKIPPED);
        if (keys.length > MAX_STORED_SKIPPED_KEYS) {
            const sorted = keys.sort((a, b) => {
                const idxA = parseInt(a.split(':')[1] || '0', 10);
                const idxB = parseInt(b.split(':')[1] || '0', 10);
                return idxA - idxB;
            });
            for (let i = 0; i < (keys.length - MAX_STORED_SKIPPED_KEYS); i++) {
                const skippedId = sorted[i];
                if (skippedId !== undefined) delete session.MKSKIPPED[skippedId];
            }
        }
    }

    async function dhRatchetStep(session: RatchetSession, newDHrPub: string): Promise<void> {
        session.PN = session.Ns;
        session.Ns = 0;
        session.Nr = 0;
        session.DHr = newDHrPub;

        // Derive new receiving chain
        const dhsPrivate = await importPkcs8PrivateKey(session.DHs.privateKeyPkcs8);
        const dhrPublic = await importRawPublicKey(session.DHr);
        const dhResult1 = await derive32(dhsPrivate, dhrPublic);
        const kdf1 = await kdfRK(b64ToBytes(session.RK), dhResult1);
        session.RK = bytesToB64(kdf1.rootKey);
        session.CKr = bytesToB64(kdf1.chainKey);

        // Generate new sending keypair and derive new sending chain
        const newDHs = await generateX25519KeyPair();
        session.DHs = await exportDHKeyPair(newDHs);
        const dhResult2 = await derive32(newDHs.privateKey, dhrPublic);
        const kdf2 = await kdfRK(b64ToBytes(session.RK), dhResult2);
        session.RK = bytesToB64(kdf2.rootKey);
        session.CKs = bytesToB64(kdf2.chainKey);
    }

    async function encryptWithDoubleRatchet(session: RatchetSession, plainText: string, aadContext: AADContext = {}) {
        if (!session.CKs) {
            throw new Error('Sending chain not initialized');
        }

        const ckBytes = b64ToBytes(session.CKs);
        const { messageKeyRaw, nextChainKey } = await ratchetStep(ckBytes);
        const messageIndex = session.Ns;

        const mk = await importMessageKey(messageKeyRaw);
        const aad = buildEnvelopeAAD({
            messageType: aadContext.messageType || 'WHISPER',
            chatId: aadContext.chatId,
            messageIndex,
            previousChainLength: session.PN || 0,
            ratchetPublicKey: session.DHs.publicKey
        });
        const encrypted = await aesEncryptWithKey(plainText, mk, aad);

        session.CKs = bytesToB64(nextChainKey);
        session.Ns = (session.Ns || 0) + 1;

        return {
            encrypted,
            messageIndex,
            ratchetPublicKey: session.DHs.publicKey,
            previousChainLength: session.PN || 0
        };
    }

    async function getOrCreateSelfSession(localBundle: DeviceBundle): Promise<RatchetSession> {
        const existing = getSession(localBundle.deviceId, localBundle.deviceId);
        if (existing && existing.version === 4 && existing.CKs && existing.CKr) {
            return existing;
        }
        const DHs = await generateX25519KeyPair();
        const DHsExported = await exportDHKeyPair(DHs);
        const chain = crypto.getRandomValues(new Uint8Array(32));
        const root = crypto.getRandomValues(new Uint8Array(32));
        const session: RatchetSession = {
            localDeviceId: localBundle.deviceId,
            remoteDeviceId: localBundle.deviceId,
            RK: bytesToB64(root),
            DHs: DHsExported,
            DHr: DHsExported.publicKey,
            CKs: bytesToB64(chain),
            CKr: bytesToB64(chain),
            Ns: 0,
            Nr: 0,
            PN: 0,
            MKSKIPPED: {},
            senderIdentityPublicKey: localBundle.identity.publicKey,
            establishedAt: Date.now(),
            version: 4
        };
        await storeSession(localBundle.deviceId, localBundle.deviceId, session);
        return session;
    }

    function assertNoUnverifiedSiblingDevices(targets: Map<string, TargetDevice>, localDeviceId: string): void {
        const remotes = [...targets.values()].filter(
            device => device.deviceId !== localDeviceId && device.identityPublicKey
        );
        const byUser = new Map<number, TargetDevice[]>();
        for (const device of remotes) {
            const list = byUser.get(device.userId) || [];
            list.push(device);
            byUser.set(device.userId, list);
        }
        for (const devices of byUser.values()) {
            const hasVerified = devices.some(device =>
                getRemoteIdentityTrust(device.deviceId, device.identityPublicKey).trustState === 'VERIFIED'
            );
            if (!hasVerified) continue;
            const extra = devices.find(device =>
                getRemoteIdentityTrust(device.deviceId, device.identityPublicKey).trustState === 'UNVERIFIED'
            );
            if (extra) {
                throw new Error('UNVERIFIED_DEVICE:' + extra.deviceId);
            }
        }
    }

    async function decryptWithDoubleRatchet(session: RatchetSession, envelope: DecryptEnvelope): Promise<string> {
        session.MKSKIPPED = session.MKSKIPPED || {};
        const ratchetPub = envelope.ratchetPublicKey;
        const msgIdx = envelope.messageIndex ?? 0;
        const sameRatchet = publicKeysEqual(ratchetPub, session.DHr);

        // 1. Try previously stored skipped message keys
        const skippedResult = await trySkippedMessageKeys(session, envelope);
        if (skippedResult !== null) return skippedResult;

        // 2. If new DH ratchet public key, perform DH ratchet
        if (ratchetPub && !sameRatchet) {
            log('[decrypt] DH ratchet sender=' + (envelope.senderDeviceId || '?')
                + ' idx=' + msgIdx
                + ' nr=' + (session.Nr || 0)
                + ' chatId=' + envelope._chatId);
            await skipMessageKeys(session, envelope.previousChainLength ?? 0);
            await dhRatchetStep(session, ratchetPub);
        }

        // 3. Skip to the correct message index in the receiving chain
        if (session.CKr == null) {
            throw new Error('Receiving chain not initialized for device ' + (envelope.senderDeviceId || '?'));
        }

        await skipMessageKeys(session, msgIdx);

        // 4. Derive the message key for this index (check skipped keys first)
        const ckBytes = b64ToBytes(session.CKr);
        const { messageKeyRaw, nextChainKey } = await ratchetStep(ckBytes);

        const mk = await importMessageKey(messageKeyRaw);
        let plainText;
        try {
            plainText = await decryptCiphertextWithEnvelopeAad(
                envelope.ciphertext, envelope.nonce, mk, { ...envelope, messageIndex: msgIdx }
            );
        } catch (error) {
            throw new Error(
                'AES-GCM failed for ' + (envelope.messageType || 'WHISPER')
                + ' idx=' + msgIdx
                + ' nr=' + (session.Nr || 0)
                + ' chatId=' + envelope._chatId
                + ' dh=' + (sameRatchet ? 'same' : 'new')
                + (errorMessage(error) ? ' (' + errorMessage(error) + ')' : '')
            );
        }

        session.CKr = bytesToB64(nextChainKey);
        session.Nr = (session.Nr || 0) + 1;
        return plainText;
    }

    // ─── Fanout (send to chat) ─────────────────────────────────────────────────

    async function buildFanoutRequest(api: CryptoApi, chatId: number, plainText: string) {
        return withCryptoStateLock(() => buildFanoutRequestUnlocked(api, chatId, plainText));
    }

    async function buildFanoutRequestUnlocked(api: CryptoApi, chatId: number, plainText: string) {
        const localBundle = await ensureDeviceRegistered(api);
        const resolved = await api('/api/crypto/resolve-chat-devices/' + encodeURIComponent(chatId), { method: 'POST' }) as ResolveChatDevicesResponse;

        const envelopes: EncryptedEnvelope[] = [];
        const uniqueTargets = new Map<string, TargetDevice>();
        for (const dev of (resolved.targetDevices || [])) {
            if (dev?.deviceId && !uniqueTargets.has(dev.deviceId)) {
                uniqueTargets.set(dev.deviceId, dev);
            }
        }

        for (const targetDevice of uniqueTargets.values()) {
            if (targetDevice.deviceId !== localBundle.deviceId && targetDevice.identityPublicKey) {
                const trustState = await observeRemoteIdentity(targetDevice.deviceId, targetDevice.identityPublicKey);
                if (trustState === 'KEY_CHANGED') {
                    throw new Error('IDENTITY_KEY_CHANGED:' + targetDevice.deviceId);
                }
                if (trustState === 'BLOCKED') {
                    throw new Error('IDENTITY_BLOCKED:' + targetDevice.deviceId);
                }
            }
        }
        assertNoUnverifiedSiblingDevices(uniqueTargets, localBundle.deviceId);

        for (const targetDevice of uniqueTargets.values()) {
            if (targetDevice.deviceId === localBundle.deviceId) {
                const session = await getOrCreateSelfSession(localBundle);
                const { encrypted, messageIndex, ratchetPublicKey, previousChainLength } =
                    await encryptWithDoubleRatchet(session, plainText, {
                        messageType: 'SELF_WHISPER',
                        chatId
                    });
                await storeSession(localBundle.deviceId, localBundle.deviceId, session);
                envelopes.push({
                    targetDeviceId: targetDevice.deviceId,
                    targetUserId: targetDevice.userId,
                    messageType: 'SELF_WHISPER',
                    senderIdentityPublicKey: localBundle.identity.publicKey,
                    ephemeralPublicKey: null,
                    ratchetPublicKey,
                    previousChainLength,
                    ciphertext: encrypted.ciphertext,
                    nonce: encrypted.nonce,
                    messageIndex,
                    signedPreKeyId: null,
                    oneTimePreKeyId: null,
                    timestamp: Date.now(),
                    _chatId: chatId
                });
                continue;
            }

            let session = getSession(localBundle.deviceId, targetDevice.deviceId);
            let ephemeralPublicKey = null;
            let isNewSession = false;
            let resolvedSignedPreKey = targetDevice.signedPreKey || null;
            let resolvedOneTimePreKey = null;

            if (!session || session.version !== 4) {
                const reserved = await api(
                    '/api/crypto/chats/' + encodeURIComponent(chatId) + '/devices/' + encodeURIComponent(targetDevice.deviceId) + '/reserve-prekey',
                    { method: 'POST' }
                ) as ReservePrekeyResponse;
                resolvedSignedPreKey = reserved?.signedPreKey || targetDevice.signedPreKey || null;
                resolvedOneTimePreKey = reserved?.oneTimePreKey || null;
                if (!resolvedOneTimePreKey) {
                    throw new Error('ONE_TIME_PREKEY_EXHAUSTED:' + targetDevice.deviceId);
                }
                const created = await createInitiatorSession(localBundle, {
                    ...targetDevice,
                    signedPreKey: resolvedSignedPreKey,
                    oneTimePreKey: resolvedOneTimePreKey,
                });
                session = created.session;
                ephemeralPublicKey = created.ephemeralPublicKey;
                isNewSession = true;
            }

            const { encrypted, messageIndex, ratchetPublicKey, previousChainLength } =
                await encryptWithDoubleRatchet(session, plainText, {
                    messageType: isNewSession ? 'PREKEY_WHISPER' : 'WHISPER',
                    chatId
                });
            await storeSession(localBundle.deviceId, targetDevice.deviceId, session);

            envelopes.push({
                targetDeviceId: targetDevice.deviceId,
                targetUserId: targetDevice.userId,
                messageType: isNewSession ? 'PREKEY_WHISPER' : 'WHISPER',
                senderIdentityPublicKey: localBundle.identity.publicKey,
                ephemeralPublicKey: isNewSession ? ephemeralPublicKey : null,
                ratchetPublicKey,
                previousChainLength,
                ciphertext: encrypted.ciphertext,
                nonce: encrypted.nonce,
                messageIndex,
                signedPreKeyId: isNewSession && resolvedSignedPreKey ? resolvedSignedPreKey.preKeyId : null,
                oneTimePreKeyId: isNewSession && resolvedOneTimePreKey ? resolvedOneTimePreKey.preKeyId : null,
                timestamp: Date.now(),
                _chatId: chatId
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

    async function forgetSession(localDeviceId: string, remoteDeviceId: string): Promise<void> {
        const sessions = loadSessions();
        const key = sessionKey(localDeviceId, remoteDeviceId);
        if (!sessions[key]) return;
        delete sessions[key];
        await saveSessions(sessions);
        log('[E2EE] Forgot stale session with ' + remoteDeviceId);
    }

    async function decryptEnvelope(envelope: DecryptEnvelope) {
        return withCryptoStateLock(() => decryptEnvelopeUnlocked(envelope));
    }

    async function decryptEnvelopeUnlocked(envelope: DecryptEnvelope): Promise<string> {
        const localBundle = getLocalDeviceBundle();
        if (!localBundle) throw new Error('Local device bundle is missing');

        log('[decrypt] senderDeviceId=' + envelope.senderDeviceId + ' messageType=' + envelope.messageType + ' messageIndex=' + envelope.messageIndex);

        if (envelope.messageType !== 'SELF_WHISPER' && envelope.senderIdentityPublicKey) {
            const trustState = await observeRemoteIdentity(envelope.senderDeviceId, envelope.senderIdentityPublicKey);
            if (trustState === 'KEY_CHANGED') {
                throw new Error('IDENTITY_KEY_CHANGED:' + envelope.senderDeviceId);
            }
            if (trustState === 'BLOCKED') {
                throw new Error('IDENTITY_BLOCKED:' + envelope.senderDeviceId);
            }
        }

        if (envelope.messageType === 'SELF_WHISPER') {
            if (envelope.ratchetPublicKey) {
                const session = getSession(localBundle.deviceId, localBundle.deviceId);
                if (!session) throw new Error('SESSION_STALE:' + (envelope.senderDeviceId || localBundle.deviceId));
                const plainText = await decryptWithDoubleRatchet(session, envelope);
                await storeSession(localBundle.deviceId, localBundle.deviceId, session);
                return plainText;
            }
            return decryptSelfEnvelope(localBundle, envelope);
        }

        let session = getSession(localBundle.deviceId, envelope.senderDeviceId);
        const isPreKeyBootstrap = envelope.messageType === 'PREKEY_WHISPER';

        if (isPreKeyBootstrap) {
            if (session) {
                log('[decrypt] Peer re-initiated session with', envelope.senderDeviceId);
                try {
                    const fresh = await bootstrapRecipientSession(localBundle, envelope);
                    const plainText = await decryptWithDoubleRatchet(fresh, envelope);
                    await commitRecipientBootstrap(
                        localBundle,
                        envelope.senderDeviceId,
                        fresh,
                        envelope.oneTimePreKeyId
                    );
                    log('[decrypt] OK replaced session messageIndex=' + envelope.messageIndex);
                    return plainText;
                } catch (error) {
                    throw new Error('PREKEY_REPLAY:' + envelope.senderDeviceId);
                }
            }
            log('[decrypt] Bootstrap X3DH + Double Ratchet session with', envelope.senderDeviceId);
            session = await bootstrapRecipientSession(localBundle, envelope);
        }

        if (!session) {
            throw new Error('SESSION_STALE:' + envelope.senderDeviceId);
        }

        if (session.version !== 4) {
            await forgetSession(localBundle.deviceId, envelope.senderDeviceId);
            throw new Error('Session version mismatch (expected 4, got ' + session.version + ') — re-establish session');
        }

        try {
            const plainText = await decryptWithDoubleRatchet(session, envelope);
            if (isPreKeyBootstrap) {
                await commitRecipientBootstrap(
                    localBundle,
                    envelope.senderDeviceId,
                    session,
                    envelope.oneTimePreKeyId
                );
            } else {
                await storeSession(localBundle.deviceId, envelope.senderDeviceId, session);
            }

            log('[decrypt] OK messageIndex=' + envelope.messageIndex);
            return plainText;
        } catch (error) {
            throw error;
        }
    }

    // ─── File encryption / decryption (AES-256-GCM with random key) ────────────

    async function encryptFile(fileArrayBuffer: ArrayBuffer) {
        assertWebCryptoAvailable();
        const key = crypto.getRandomValues(new Uint8Array(32));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cryptoKey = await crypto.subtle.importKey("raw", cryptoSource(key), "AES-GCM", false, ["encrypt"]);
        const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: cryptoSource(iv) }, cryptoKey, fileArrayBuffer);
        const result = new Uint8Array(iv.length + encrypted.byteLength);
        result.set(iv, 0);
        result.set(new Uint8Array(encrypted), iv.length);
        return { encrypted: result, fileKey: btoa(String.fromCharCode(...key)) };
    }

    async function decryptFile(encryptedArrayBuffer: ArrayBuffer, fileKeyBase64: string) {
        assertWebCryptoAvailable();
        const keyBytes = Uint8Array.from(atob(fileKeyBase64), c => c.charCodeAt(0));
        const data = new Uint8Array(encryptedArrayBuffer);
        const iv = data.slice(0, 12);
        const ciphertext = data.slice(12);
        const cryptoKey = await crypto.subtle.importKey("raw", cryptoSource(keyBytes), "AES-GCM", false, ["decrypt"]);
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: cryptoSource(iv) }, cryptoKey, cryptoSource(ciphertext));
        return decrypted;
    }

    // ─── Public API ────────────────────────────────────────────────────────────

    await initializeSecureState();

    const api: CryptoEngine = {
        getOrCreateDeviceId,
        getLocalDeviceBundle,
        resetLocalDeviceIdentity,
        importLocalDeviceBundle,
        ensureDeviceRegistered,
        replenishOneTimePreKeys,
        buildFanoutRequest,
        decryptEnvelope,
        encryptFile,
        decryptFile,
        verifyRemoteIdentity,
        blockRemoteIdentity,
        getRemoteIdentityTrust,
        getSecureStorageBackend: secureStorageBackend,
        __clearSecureStorageForTests: clearSecureStorageForTests,
        __exportSessionStateForTests: () => structuredClone(sessionState),
        __importSessionStateForTests: async (sessions) => saveSessions(sessions || {})
    };

    bindWindowAdapter(api);
    return api;
}

function bindWindowAdapter(api: CryptoEngine) {
    const globalE2ee = globalThis as typeof globalThis & { e2ee?: CryptoEngine };
    if (globalE2ee.e2ee == null) {
        globalE2ee.e2ee = api;
    }
}

export const e2ee: CryptoEngine = await createCryptoEngine();
export default e2ee;
