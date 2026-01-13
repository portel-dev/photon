/**
 * Cloudflare D1 Store Implementations
 *
 * Production-ready stores using D1 SQLite database
 */

import { randomUUID } from 'crypto';
import type {
  Tenant,
  TenantSettings,
  User,
  Membership,
  PhotonGrant,
  ElicitationRequest,
} from '../types/index.js';
import type { TenantStore } from '../middleware/tenant.js';
import type { UserStore, MembershipStore } from '../middleware/auth.js';
import type { ElicitationStore, GrantStore } from '../auth/oauth.js';
import type { D1Client } from './d1-client.js';

// ============================================================================
// Row Types (D1 returns strings for dates)
// ============================================================================

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  region: string;
  plan: string;
  encryption_key_id: string;
  settings: string;
  created_at: string;
}

interface UserRow {
  id: string;
  email: string;
  email_verified: number;
  created_at: string;
}

interface MembershipRow {
  tenant_id: string;
  user_id: string;
  role: string;
  status: string;
  invited_by: string | null;
  joined_at: string;
}

interface GrantRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  photon_id: string;
  provider: string;
  scopes: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  token_expires_at: string;
  created_at: string;
  updated_at: string;
}

interface ElicitationRow {
  id: string;
  session_id: string;
  photon_id: string;
  provider: string;
  required_scopes: string;
  status: string;
  redirect_uri: string;
  code_verifier: string | null;
  created_at: string;
  expires_at: string;
}

// ============================================================================
// D1 Tenant Store
// ============================================================================

export class D1TenantStore implements TenantStore {
  constructor(private db: D1Client) {}

  async findBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.db.first<TenantRow>(
      'SELECT * FROM tenants WHERE slug = ?',
      slug
    );
    return row ? this.rowToTenant(row) : null;
  }

  async findByCustomDomain(domain: string): Promise<Tenant | null> {
    // Query tenants where settings.customDomain matches
    const rows = await this.db.all<TenantRow>(
      'SELECT * FROM tenants WHERE json_extract(settings, \'$.customDomain\') = ?',
      domain
    );
    return rows.length > 0 ? this.rowToTenant(rows[0]) : null;
  }

  async findById(id: string): Promise<Tenant | null> {
    const row = await this.db.first<TenantRow>(
      'SELECT * FROM tenants WHERE id = ?',
      id
    );
    return row ? this.rowToTenant(row) : null;
  }

  async create(tenant: Omit<Tenant, 'createdAt'>): Promise<Tenant> {
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT INTO tenants (id, name, slug, region, plan, encryption_key_id, settings, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      tenant.id,
      tenant.name,
      tenant.slug,
      tenant.region,
      tenant.plan,
      tenant.encryptionKeyId,
      JSON.stringify(tenant.settings),
      now
    );
    return { ...tenant, createdAt: new Date(now) };
  }

  async update(id: string, data: Partial<Tenant>): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.plan !== undefined) {
      updates.push('plan = ?');
      params.push(data.plan);
    }
    if (data.settings !== undefined) {
      updates.push('settings = ?');
      params.push(JSON.stringify(data.settings));
    }

    if (updates.length === 0) return;

    params.push(id);
    await this.db.run(
      `UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`,
      ...params
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM tenants WHERE id = ?', id);
  }

  private rowToTenant(row: TenantRow): Tenant {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      region: row.region,
      plan: row.plan as Tenant['plan'],
      encryptionKeyId: row.encryption_key_id,
      settings: JSON.parse(row.settings) as TenantSettings,
      createdAt: new Date(row.created_at),
    };
  }
}

// ============================================================================
// D1 User Store
// ============================================================================

export class D1UserStore implements UserStore {
  constructor(private db: D1Client) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.db.first<UserRow>(
      'SELECT * FROM users WHERE id = ?',
      id
    );
    return row ? this.rowToUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.db.first<UserRow>(
      'SELECT * FROM users WHERE email = ?',
      email.toLowerCase()
    );
    return row ? this.rowToUser(row) : null;
  }

  async create(user: Omit<User, 'createdAt'>): Promise<User> {
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT INTO users (id, email, email_verified, created_at)
       VALUES (?, ?, ?, ?)`,
      user.id,
      user.email.toLowerCase(),
      user.emailVerified ? 1 : 0,
      now
    );
    return { ...user, createdAt: new Date(now) };
  }

  async update(id: string, data: Partial<User>): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.emailVerified !== undefined) {
      updates.push('email_verified = ?');
      params.push(data.emailVerified ? 1 : 0);
    }

    if (updates.length === 0) return;

    params.push(id);
    await this.db.run(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      ...params
    );
  }

  private rowToUser(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      emailVerified: row.email_verified === 1,
      createdAt: new Date(row.created_at),
    };
  }
}

// ============================================================================
// D1 Membership Store
// ============================================================================

export class D1MembershipStore implements MembershipStore {
  constructor(private db: D1Client) {}

  async find(tenantId: string, userId: string): Promise<Membership | null> {
    const row = await this.db.first<MembershipRow>(
      'SELECT * FROM memberships WHERE tenant_id = ? AND user_id = ?',
      tenantId,
      userId
    );
    return row ? this.rowToMembership(row) : null;
  }

  async findByUser(userId: string): Promise<Membership[]> {
    const rows = await this.db.all<MembershipRow>(
      'SELECT * FROM memberships WHERE user_id = ?',
      userId
    );
    return rows.map(r => this.rowToMembership(r));
  }

  async findByTenant(tenantId: string): Promise<Membership[]> {
    const rows = await this.db.all<MembershipRow>(
      'SELECT * FROM memberships WHERE tenant_id = ?',
      tenantId
    );
    return rows.map(r => this.rowToMembership(r));
  }

  async create(membership: Omit<Membership, 'joinedAt'>): Promise<Membership> {
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT INTO memberships (tenant_id, user_id, role, status, invited_by, joined_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      membership.tenantId,
      membership.userId,
      membership.role,
      membership.status,
      membership.invitedBy ?? null,
      now
    );
    return { ...membership, joinedAt: new Date(now) };
  }

  async update(tenantId: string, userId: string, data: Partial<Membership>): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.role !== undefined) {
      updates.push('role = ?');
      params.push(data.role);
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(data.status);
    }

    if (updates.length === 0) return;

    params.push(tenantId, userId);
    await this.db.run(
      `UPDATE memberships SET ${updates.join(', ')} WHERE tenant_id = ? AND user_id = ?`,
      ...params
    );
  }

  async delete(tenantId: string, userId: string): Promise<void> {
    await this.db.run(
      'DELETE FROM memberships WHERE tenant_id = ? AND user_id = ?',
      tenantId,
      userId
    );
  }

  private rowToMembership(row: MembershipRow): Membership {
    return {
      tenantId: row.tenant_id,
      userId: row.user_id,
      role: row.role as Membership['role'],
      status: row.status as Membership['status'],
      invitedBy: row.invited_by ?? undefined,
      joinedAt: new Date(row.joined_at),
    };
  }
}

// ============================================================================
// D1 Grant Store
// ============================================================================

export class D1GrantStore implements GrantStore {
  constructor(private db: D1Client) {}

  async find(
    tenantId: string,
    photonId: string,
    provider: string,
    userId?: string
  ): Promise<PhotonGrant | null> {
    const row = await this.db.first<GrantRow>(
      `SELECT * FROM photon_grants
       WHERE tenant_id = ? AND photon_id = ? AND provider = ? AND user_id IS ?`,
      tenantId,
      photonId,
      provider,
      userId ?? null
    );
    return row ? this.rowToGrant(row) : null;
  }

  async create(grant: Omit<PhotonGrant, 'id' | 'createdAt' | 'updatedAt'>): Promise<PhotonGrant> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT INTO photon_grants
       (id, tenant_id, user_id, photon_id, provider, scopes, access_token_encrypted,
        refresh_token_encrypted, token_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      grant.tenantId,
      grant.userId ?? null,
      grant.photonId,
      grant.provider,
      JSON.stringify(grant.scopes),
      grant.accessTokenEncrypted,
      grant.refreshTokenEncrypted ?? null,
      grant.tokenExpiresAt.toISOString(),
      now,
      now
    );
    return {
      ...grant,
      id,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  async update(id: string, data: Partial<PhotonGrant>): Promise<void> {
    const updates: string[] = ['updated_at = ?'];
    const params: unknown[] = [new Date().toISOString()];

    if (data.accessTokenEncrypted !== undefined) {
      updates.push('access_token_encrypted = ?');
      params.push(data.accessTokenEncrypted);
    }
    if (data.refreshTokenEncrypted !== undefined) {
      updates.push('refresh_token_encrypted = ?');
      params.push(data.refreshTokenEncrypted);
    }
    if (data.scopes !== undefined) {
      updates.push('scopes = ?');
      params.push(JSON.stringify(data.scopes));
    }
    if (data.tokenExpiresAt !== undefined) {
      updates.push('token_expires_at = ?');
      params.push(data.tokenExpiresAt.toISOString());
    }

    params.push(id);
    await this.db.run(
      `UPDATE photon_grants SET ${updates.join(', ')} WHERE id = ?`,
      ...params
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM photon_grants WHERE id = ?', id);
  }

  async findByUser(tenantId: string, userId: string): Promise<PhotonGrant[]> {
    const rows = await this.db.all<GrantRow>(
      'SELECT * FROM photon_grants WHERE tenant_id = ? AND user_id = ?',
      tenantId,
      userId
    );
    return rows.map(r => this.rowToGrant(r));
  }

  private rowToGrant(row: GrantRow): PhotonGrant {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id ?? undefined,
      photonId: row.photon_id,
      provider: row.provider,
      scopes: JSON.parse(row.scopes),
      accessTokenEncrypted: row.access_token_encrypted,
      refreshTokenEncrypted: row.refresh_token_encrypted ?? undefined,
      tokenExpiresAt: new Date(row.token_expires_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// ============================================================================
// D1 Elicitation Store
// ============================================================================

export class D1ElicitationStore implements ElicitationStore {
  constructor(private db: D1Client) {}

  async create(data: Omit<ElicitationRequest, 'id' | 'createdAt'>): Promise<ElicitationRequest> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.db.run(
      `INSERT INTO elicitation_requests
       (id, session_id, photon_id, provider, required_scopes, status, redirect_uri, code_verifier, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.sessionId,
      data.photonId,
      data.provider,
      JSON.stringify(data.requiredScopes),
      data.status,
      data.redirectUri,
      data.codeVerifier ?? null,
      now,
      data.expiresAt.toISOString()
    );
    return {
      ...data,
      id,
      createdAt: new Date(now),
    };
  }

  async get(id: string): Promise<ElicitationRequest | null> {
    const row = await this.db.first<ElicitationRow>(
      'SELECT * FROM elicitation_requests WHERE id = ?',
      id
    );
    if (!row) return null;

    const request = this.rowToElicitation(row);

    // Check expiry
    if (request.expiresAt.getTime() < Date.now()) {
      await this.delete(id);
      return null;
    }

    return request;
  }

  async update(id: string, data: Partial<ElicitationRequest>): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(data.status);
    }

    if (updates.length === 0) return;

    params.push(id);
    await this.db.run(
      `UPDATE elicitation_requests SET ${updates.join(', ')} WHERE id = ?`,
      ...params
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM elicitation_requests WHERE id = ?', id);
  }

  async cleanup(): Promise<number> {
    const result = await this.db.run(
      'DELETE FROM elicitation_requests WHERE expires_at < ?',
      new Date().toISOString()
    );
    return result.changes;
  }

  private rowToElicitation(row: ElicitationRow): ElicitationRequest {
    return {
      id: row.id,
      sessionId: row.session_id,
      photonId: row.photon_id,
      provider: row.provider,
      requiredScopes: JSON.parse(row.required_scopes),
      status: row.status as ElicitationRequest['status'],
      redirectUri: row.redirect_uri,
      codeVerifier: row.code_verifier ?? undefined,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    };
  }
}
