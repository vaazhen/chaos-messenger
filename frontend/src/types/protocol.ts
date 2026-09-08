// ─── E2EE Protocol Types ───────────────────────────────────────────────────
// These types define the wire format and internal state for the X3DH + Double
// Ratchet protocol. They serve as the authoritative reference for the
// crypto-engine module and its consumers.

/** Versioned protocol message types transported over WebSocket / REST. */
export type MessageType = 'WHISPER' | 'PREKEY_WHISPER' | 'SELF_WHISPER';
export type VerificationMethod = 'MANUAL' | 'SAFETY_NUMBER' | 'QR_CODE';

/** AES-GCM encrypted envelope sent to a single recipient device. */
export interface EncryptedEnvelope {
  targetDeviceId: string;
  targetUserId: number;
  messageType: MessageType;
  senderDeviceId?: string;
  senderIdentityPublicKey: string;
  ephemeralPublicKey: string | null;
  ratchetPublicKey: string | null;
  previousChainLength: number | null;
  ciphertext: string;
  nonce: string;
  messageIndex: number | null;
  signedPreKeyId: number | null;
  oneTimePreKeyId: number | null;
  timestamp: number;
  /** Client-only context used to construct AAD; never trusted as server state. */
  _chatId?: number;
}

/** Envelope as received by the decrypt path (includes sender context). */
export interface DecryptEnvelope {
  messageType: MessageType;
  senderDeviceId: string;
  senderIdentityPublicKey?: string;
  ciphertext: string;
  nonce: string;
  ratchetPublicKey?: string | null;
  messageIndex?: number;
  previousChainLength?: number;
  signedPreKeyId?: number | null;
  oneTimePreKeyId?: number | null;
  ephemeralPublicKey?: string | null;
  _chatId?: number;
  _senderUserId?: number;
}

/** DH ratchet key pair stored with the session (PKCS#8 private key). */
export interface DhRatchetKeyPair {
  publicKey: string;
  privateKeyPkcs8: string;
}

/** Double Ratchet session state (v4). */
export interface RatchetSession {
  version: number;
  DHs: DhRatchetKeyPair;
  DHr: string | null;
  RK: string;
  CKs: string | null;
  CKr: string | null;
  Ns: number;
  Nr: number;
  PN: number;
  MKSKIPPED: Record<string, string>;
  localDeviceId?: string;
  remoteDeviceId?: string;
  senderIdentityPublicKey?: string;
  _ephemeralPublicKey?: string;
  establishedAt?: number;
  rootKey?: string;
  receivingChainKey?: string;
  sendingChainKey?: string;
}

/** Identity key pair stored in secure storage. */
export interface IdentityKeyPair {
  publicKey: string;
  privateKeyPkcs8: string;
}

/** Signing key pair for signed pre-key signatures. */
export interface SigningKeyPair {
  publicKeySpki: string;
  privateKeyPkcs8: string;
}

/** A single pre-key (signed or one-time). */
export interface PreKey {
  preKeyId: number;
  publicKey: string;
  privateKeyPkcs8: string;
  signature?: string;
  published?: boolean;
  createdAt?: number;
}

/** Full device bundle stored in IndexedDB / LocalStorage. */
export interface DeviceBundle {
  deviceId: string;
  registrationId: number;
  identity: IdentityKeyPair;
  signingKey: SigningKeyPair;
  signedPreKey: PreKey;
  previousSignedPreKey?: PreKey;
  oneTimePreKeys: PreKey[];
  consumedPreKeyIds?: number[];
}

/** Target device info returned by resolve-chat-devices API. */
export interface TargetDevice {
  userId: number;
  deviceId: string;
  identityPublicKey: string;
  signingPublicKey: string;
  signedPreKey: PreKey | null;
  oneTimePreKey: PreKey | null;
}

/** X3DH bootstrap result — new session + ephemeral public key. */
export interface BootstrapResult {
  session: RatchetSession;
  ephemeralPublicKey: string;
}

/** Result of encryptWithDoubleRatchet. */
export interface EncryptionResult {
  encrypted: { ciphertext: string; nonce: string };
  messageIndex: number;
  ratchetPublicKey: string;
  previousChainLength: number;
}

/** Fanout request sent to /api/crypto/send-message. */
export interface FanoutRequest {
  chatId: number;
  clientMessageId: string;
  senderDeviceId: string;
  envelopes: EncryptedEnvelope[];
}

/** Trust state for a remote device identity. */
export type TrustState = 'UNVERIFIED' | 'VERIFIED' | 'KEY_CHANGED' | 'BLOCKED';

export interface RemoteIdentityTrust {
  trustState: TrustState;
  verificationMethod?: VerificationMethod;
  verifiedAt?: number;
  identityPublicKey: string;
  userId?: number;
  firstSeenAt?: number;
  lastSeenAt?: number;
  changedAt?: number;
  previousIdentityPublicKey?: string;
}

/** File encryption result. */
export interface EncryptedFile {
  encrypted: Uint8Array;
  fileKey: string;
}

/** AAD context for envelope authentication. Unknown types encode as 0. */
export interface AADContext {
  messageType?: MessageType | string | undefined;
  chatId?: number | undefined;
  messageIndex?: number | null | undefined;
  previousChainLength?: number | null | undefined;
  senderDeviceId?: string | null | undefined;
  targetDeviceId?: string | null | undefined;
  ratchetPublicKey?: string | null | undefined;
}

export type CryptoApi = (path: string, opts?: RequestInit) => Promise<unknown>;

export type MessagePayloadType = "text" | "image" | "voice" | "video_note" | "file" | string;

export interface CompactReply {
  id: string | number | null;
  _text: string;
  _img: boolean;
  _voice: boolean;
  _videoNote: boolean;
}

export interface MessageAttachment {
  attachmentId?: string | undefined;
  fileName?: string | undefined;
  mimeType?: string | undefined;
  durationMs?: number | undefined;
  transcript?: string | undefined;
  fileKey?: string | undefined;
  objectUrl?: string | undefined;
  blob?: Blob | undefined;
  size?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

export interface MessagePayloadV1 {
  v?: number;
  type?: MessagePayloadType;
  text?: string;
  image?: { dataUrl?: string };
  dataUrl?: string;
  voice?: { dataUrl?: string; transcript?: string; durationMs?: number; mime?: string };
  videoNote?: { src?: string; durationMs?: number; mime?: string };
  attachment?: MessageAttachment | null;
  ttl?: number | null;
  replyTo?: CompactReply | Record<string, unknown> | null;
}

export interface ParsedMessage {
  text: string;
  img: string | null;
  voice: { dataUrl?: string; transcript?: string; durationMs?: number; mime?: string } | null;
  videoNote: { src: string; durationMs: number; mime: string } | null;
  payload: MessagePayloadV1 | null;
  attachment: MessageAttachment | null;
  replyTo?: CompactReply | Record<string, unknown> | null;
  ttl?: number | null;
}

export interface TimelineMessage {
  id?: string | number | undefined;
  messageId?: string | number | undefined;
  content?: string | undefined;
  status?: string | undefined;
  deleted?: boolean | undefined;
  deletedAt?: string | null | undefined;
  envelope?: DecryptEnvelope | null | undefined;
  senderDeviceId?: string | undefined;
  chatId?: number | string | undefined;
  senderId?: string | number | undefined;
  createdAt?: string | undefined;
  _text?: string | undefined;
  _img?: unknown;
  _voice?: unknown;
  _videoNote?: unknown;
  _payload?: MessagePayloadV1 | null | undefined;
  _attachment?: MessageAttachment | null | undefined;
  _ttl?: number | null | undefined;
  _replyTo?: CompactReply | Record<string, unknown> | null | undefined;
  expiresAt?: string | null | undefined;
  _time?: string | undefined;
  _temp?: boolean | undefined;
  _out?: boolean | undefined;
  _clientMessageId?: string | undefined;
  myReactions?: string[] | undefined;
  reactions?: Record<string, number> | undefined;
}

/** Options when applying a decrypted WS/API message to a chat timeline. */
export interface IncomingTimelineApplyOptions {
  isOut: boolean;
  clientMessageId?: string | undefined;
}

export type ChatMessageMap = Record<string, TimelineMessage[]>;

/** Exported public API of the crypto engine. */
export interface CryptoEngine {
  getOrCreateDeviceId(): string;
  getLocalDeviceBundle(): DeviceBundle | null;
  ensureDeviceRegistered(api: CryptoApi): Promise<DeviceBundle>;
  replenishOneTimePreKeys(api: CryptoApi): Promise<DeviceBundle | null>;
  resetLocalDeviceIdentity(): Promise<void>;
  buildFanoutRequest(api: CryptoApi, chatId: number, plainText: string): Promise<FanoutRequest>;
  decryptEnvelope(envelope: DecryptEnvelope): Promise<string>;
  encryptFile(fileArrayBuffer: ArrayBuffer): Promise<EncryptedFile>;
  decryptFile(encryptedArrayBuffer: ArrayBuffer, fileKeyBase64: string): Promise<ArrayBuffer>;
  getRemoteIdentityTrust(deviceId: string, identityPublicKey?: string | null): RemoteIdentityTrust;
  verifyRemoteIdentity(deviceId: string, identityPublicKey: string, method?: VerificationMethod): Promise<void>;
  blockRemoteIdentity(deviceId: string, identityPublicKey: string): Promise<void>;
  importLocalDeviceBundle(bundle: DeviceBundle): Promise<string>;
  getSecureStorageBackend(): string;
  // Test-only internals
  __clearSecureStorageForTests?(): Promise<void>;
  __importSessionStateForTests?(sessions: Record<string, RatchetSession>): Promise<void>;
  __exportSessionStateForTests?(): Record<string, RatchetSession>;
}

declare global {
  interface Window {
    e2ee?: CryptoEngine;
  }
}
