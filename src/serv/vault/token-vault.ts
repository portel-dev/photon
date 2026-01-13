/**
 * Token Vault
 *
 * Secure encrypted storage for OAuth tokens with per-tenant encryption keys
 * Uses AES-256-GCM for authenticated encryption
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// ============================================================================
// Vault Interface
// ============================================================================

export interface TokenVault {
  /**
   * Encrypt a token for storage
   */
  encrypt(tenantId: string, plaintext: string): Promise<string>;

  /**
   * Decrypt a stored token
   */
  decrypt(tenantId: string, ciphertext: string): Promise<string>;

  /**
   * Rotate the encryption key for a tenant
   */
  rotateKey?(tenantId: string): Promise<void>;
}

// ============================================================================
// Configuration
// ============================================================================

export interface TokenVaultConfig {
  /** Master key for deriving tenant keys (min 32 bytes) */
  masterKey: string;
  /** Salt for key derivation */
  salt?: string;
  /** Key derivation iterations (default: 100000) */
  iterations?: number;
}

// ============================================================================
// Local Token Vault (Development/Single-Instance)
// ============================================================================

/**
 * Simple token vault using derived keys from a master key
 * Suitable for development or single-instance deployments
 *
 * For production multi-instance, use KmsTokenVault with AWS KMS/GCP KMS/HashiCorp Vault
 */
export class LocalTokenVault implements TokenVault {
  private masterKey: Buffer;
  private salt: Buffer;
  private keyCache: Map<string, Buffer> = new Map();
  private iterations: number;

  constructor(config: TokenVaultConfig) {
    if (config.masterKey.length < 32) {
      throw new Error('Master key must be at least 32 characters');
    }

    this.masterKey = Buffer.from(config.masterKey, 'utf-8');
    this.salt = Buffer.from(config.salt ?? 'serv-token-vault-salt', 'utf-8');
    this.iterations = config.iterations ?? 100000;
  }

  async encrypt(tenantId: string, plaintext: string): Promise<string> {
    const key = this.deriveKey(tenantId);
    const iv = randomBytes(12); // 96 bits for GCM

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Format: base64(iv + authTag + ciphertext)
    const result = Buffer.concat([iv, authTag, encrypted]);
    return result.toString('base64');
  }

  async decrypt(tenantId: string, ciphertext: string): Promise<string> {
    const key = this.deriveKey(tenantId);
    const data = Buffer.from(ciphertext, 'base64');

    // Extract components
    const iv = data.subarray(0, 12);
    const authTag = data.subarray(12, 28);
    const encrypted = data.subarray(28);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf-8');
  }

  /**
   * Derive a tenant-specific key from the master key
   */
  private deriveKey(tenantId: string): Buffer {
    const cacheKey = tenantId;
    if (this.keyCache.has(cacheKey)) {
      return this.keyCache.get(cacheKey)!;
    }

    // Derive a unique key for this tenant using scrypt
    const tenantSalt = Buffer.concat([this.salt, Buffer.from(tenantId, 'utf-8')]);
    const key = scryptSync(this.masterKey, tenantSalt, 32, {
      N: 16384,
      r: 8,
      p: 1,
    });

    this.keyCache.set(cacheKey, key);
    return key;
  }

  /**
   * Clear the key cache (call after key rotation)
   */
  clearCache(): void {
    this.keyCache.clear();
  }
}

// ============================================================================
// KMS Token Vault (Production)
// ============================================================================

export interface KmsClient {
  /**
   * Encrypt data using a KMS key
   */
  encrypt(keyId: string, plaintext: Buffer): Promise<Buffer>;

  /**
   * Decrypt data using a KMS key
   */
  decrypt(keyId: string, ciphertext: Buffer): Promise<Buffer>;

  /**
   * Generate a data key for envelope encryption
   */
  generateDataKey(keyId: string): Promise<{
    plaintext: Buffer;
    ciphertext: Buffer;
  }>;
}

export interface KmsTokenVaultConfig {
  /** KMS client instance */
  kms: KmsClient;
  /** Function to get the KMS key ID for a tenant */
  getKeyId: (tenantId: string) => Promise<string>;
}

/**
 * Token vault using external KMS (AWS KMS, GCP KMS, etc.)
 * Uses envelope encryption for efficiency
 */
export class KmsTokenVault implements TokenVault {
  private kms: KmsClient;
  private getKeyId: (tenantId: string) => Promise<string>;
  private dataKeyCache: Map<string, { key: Buffer; encrypted: Buffer; expires: number }> = new Map();

  constructor(config: KmsTokenVaultConfig) {
    this.kms = config.kms;
    this.getKeyId = config.getKeyId;
  }

  async encrypt(tenantId: string, plaintext: string): Promise<string> {
    const { dataKey, encryptedDataKey } = await this.getDataKey(tenantId);

    // Encrypt with data key
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Format: base64(encryptedDataKeyLen(2) + encryptedDataKey + iv + authTag + ciphertext)
    const edkLen = Buffer.alloc(2);
    edkLen.writeUInt16BE(encryptedDataKey.length);

    const result = Buffer.concat([edkLen, encryptedDataKey, iv, authTag, encrypted]);
    return result.toString('base64');
  }

  async decrypt(tenantId: string, ciphertext: string): Promise<string> {
    const data = Buffer.from(ciphertext, 'base64');

    // Extract encrypted data key
    const edkLen = data.readUInt16BE(0);
    const encryptedDataKey = data.subarray(2, 2 + edkLen);
    const iv = data.subarray(2 + edkLen, 2 + edkLen + 12);
    const authTag = data.subarray(2 + edkLen + 12, 2 + edkLen + 28);
    const encrypted = data.subarray(2 + edkLen + 28);

    // Decrypt data key
    const keyId = await this.getKeyId(tenantId);
    const dataKey = await this.kms.decrypt(keyId, encryptedDataKey);

    // Decrypt content
    const decipher = createDecipheriv('aes-256-gcm', dataKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf-8');
  }

  async rotateKey(tenantId: string): Promise<void> {
    // Clear cached data key to force regeneration with new KMS key
    this.dataKeyCache.delete(tenantId);
  }

  /**
   * Get or generate a data key for envelope encryption
   */
  private async getDataKey(tenantId: string): Promise<{ dataKey: Buffer; encryptedDataKey: Buffer }> {
    const cached = this.dataKeyCache.get(tenantId);

    // Cache data keys for 1 hour
    if (cached && cached.expires > Date.now()) {
      return { dataKey: cached.key, encryptedDataKey: cached.encrypted };
    }

    // Generate new data key
    const keyId = await this.getKeyId(tenantId);
    const { plaintext, ciphertext } = await this.kms.generateDataKey(keyId);

    // Cache it
    this.dataKeyCache.set(tenantId, {
      key: plaintext,
      encrypted: ciphertext,
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    return { dataKey: plaintext, encryptedDataKey: ciphertext };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export type TokenVaultType = 'local' | 'kms';

export interface CreateTokenVaultOptions {
  type: TokenVaultType;
  masterKey?: string;
  kms?: KmsClient;
  getKeyId?: (tenantId: string) => Promise<string>;
}

export function createTokenVault(options: CreateTokenVaultOptions): TokenVault {
  switch (options.type) {
    case 'local':
      if (!options.masterKey) {
        throw new Error('Master key required for local token vault');
      }
      return new LocalTokenVault({ masterKey: options.masterKey });

    case 'kms':
      if (!options.kms || !options.getKeyId) {
        throw new Error('KMS client and getKeyId function required for KMS token vault');
      }
      return new KmsTokenVault({
        kms: options.kms,
        getKeyId: options.getKeyId,
      });

    default:
      throw new Error(`Unknown token vault type: ${options.type}`);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let tokenVaultInstance: TokenVault | null = null;

export function getTokenVault(): TokenVault {
  if (!tokenVaultInstance) {
    throw new Error('Token vault not initialized. Call initTokenVault first.');
  }
  return tokenVaultInstance;
}

export function initTokenVault(options: CreateTokenVaultOptions): TokenVault {
  tokenVaultInstance = createTokenVault(options);
  return tokenVaultInstance;
}
