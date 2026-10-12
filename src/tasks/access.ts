import { hashInputStateValue } from '../mcp/protocol/input-required.js';
import type { TaskAccessBinding } from './types.js';

export interface TaskCallerIdentity {
  id?: string;
  anonymous?: boolean;
  scope?: string;
  claims?: Record<string, unknown>;
}

export interface TaskRequestIdentity {
  scopeDir?: string;
  appSessionId?: string;
  appSessionSource?: string;
}

/**
 * Build the stable owner binding shared by legacy and modern task adapters.
 * Raw caller claims never cross the task persistence boundary.
 */
export function buildTaskAccessBinding(
  caller?: TaskCallerIdentity,
  requestContext?: TaskRequestIdentity
): TaskAccessBinding {
  const claims = caller?.claims;
  return {
    principal: hashInputStateValue({
      id: caller?.id ?? 'anonymous',
      issuer: typeof claims?.iss === 'string' ? claims.iss : '',
      audience:
        typeof claims?.aud === 'string' ? claims.aud : Array.isArray(claims?.aud) ? claims.aud : [],
      clientId: typeof claims?.client_id === 'string' ? claims.client_id : '',
    }),
    scope: hashInputStateValue({
      oauthScope: caller?.scope ?? '',
      claimScopeDir: requestContext?.scopeDir ?? '',
    }),
    ...(requestContext?.appSessionId
      ? { appSession: hashInputStateValue(requestContext.appSessionId) }
      : {}),
  };
}

export function taskAccessMatches(
  task: { owner?: TaskAccessBinding },
  owner?: TaskAccessBinding
): boolean {
  if (!owner) return true;
  if (!task.owner) return false;
  return (
    task.owner.principal === owner.principal &&
    task.owner.scope === owner.scope &&
    (task.owner.appSession ?? '') === (owner.appSession ?? '')
  );
}
