/**
 * Shared OAuth consent presentation.
 *
 * The local authorization server and generated Cloudflare worker both use
 * this contract and these template parts. The Cloudflare generator embeds
 * the same source at build time because a generated worker cannot import the
 * Photon package at runtime.
 */

export interface OAuthConsentScope {
  value: string;
  title: string;
  detail: string;
}

export interface OAuthConsentHiddenField {
  name: string;
  value: string;
}

export interface OAuthConsentViewModel {
  pageTitle: string;
  clientName: string;
  clientSubtitle: string;
  resourceName: string;
  resourceIcon: string;
  resourceDescription: string;
  description: string;
  subject: string;
  subjectSubtitle: string;
  cimdUrl?: string;
  scopes: OAuthConsentScope[];
  formAction: string;
  transactionField: string;
  transactionValue: string;
  decisionField: string;
  approveValue: string;
  denyValue: string;
  hiddenFields: OAuthConsentHiddenField[];
  allowScopeSelection: boolean;
  customCss?: string;
}

export interface OAuthConsentInput {
  clientName: string;
  clientSubtitle?: string;
  resourceName?: string;
  resourceIcon?: string;
  resourceDescription?: string;
  description?: string;
  subject?: string;
  subjectSubtitle?: string;
  cimdUrl?: string;
  scopeValues: string[];
  formAction: string;
  transactionField: string;
  transactionValue: string;
  decisionField: string;
  approveValue: string;
  denyValue: string;
  hiddenFields?: OAuthConsentHiddenField[];
  allowScopeSelection?: boolean;
  customCss?: string;
}

export const OAUTH_CONSENT_CSS = `
:root{color-scheme:light dark;--oauth-bg:#f7f8fa;--oauth-panel:#fff;--oauth-ink:#1d2433;--oauth-muted:#697386;--oauth-line:#e7e9ee;--oauth-accent:#635bff;--oauth-accent-strong:#5148e8;--oauth-soft:#f3f2ff;--oauth-shadow:#1d243314}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--oauth-bg);font:15px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--oauth-ink);display:grid;place-items:center;padding:24px 16px}
.oauth-shell{width:min(100%,720px);max-height:calc(100vh - 48px)}
.oauth-card{display:flex;flex-direction:column;max-height:inherit;background:var(--oauth-panel);border:1px solid var(--oauth-line);border-radius:16px;box-shadow:0 12px 35px var(--oauth-shadow);overflow:hidden}
.oauth-top{padding:28px 30px 24px}
.oauth-app{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.oauth-mark{width:42px;height:42px;border-radius:12px;background:var(--oauth-accent);color:#fff;display:grid;place-items:center;font-size:20px;font-weight:750}
.oauth-mark-image{display:block;width:100%;height:100%;padding:6px;object-fit:contain;border-radius:inherit;background:#fff}
.oauth-app strong{display:block;font-size:15px}.oauth-app small{display:block;color:var(--oauth-muted);font-size:12px;margin-top:2px}
.oauth-resource-description{color:var(--oauth-muted);font-size:13px;margin:-12px 0 24px;line-height:1.45}
.oauth-hero h1{font-size:25px;letter-spacing:-.035em;line-height:1.15;margin:0 0 8px}.oauth-hero p{color:var(--oauth-muted);margin:0}
.oauth-identity{display:flex;align-items:center;gap:10px;margin-top:20px;padding:10px 12px;border:1px solid var(--oauth-line);border-radius:10px}
.oauth-avatar{width:30px;height:30px;border-radius:50%;background:var(--oauth-soft);color:var(--oauth-accent-strong);display:grid;place-items:center;font-weight:700}
.oauth-identity small{display:block;color:var(--oauth-muted);font-size:12px}
.oauth-content{min-height:0;overflow:auto;border-top:1px solid var(--oauth-line);padding:22px 30px 26px}
.oauth-section-head{display:flex;justify-content:space-between;align-items:center;gap:16px}.oauth-section-head h2{font-size:14px;margin:0}
.oauth-summary{display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding:13px 14px;border:1px solid var(--oauth-line);border-radius:10px;color:var(--oauth-muted);font-size:13px}.oauth-summary b{color:var(--oauth-ink);font-weight:650}
.oauth-permissions{margin-top:10px}.oauth-permissions summary{cursor:pointer;color:var(--oauth-accent);font-size:12px;font-weight:650;padding:4px 0}.oauth-permissions>div{max-height:min(42vh,360px);overflow-y:auto;padding-right:6px;scrollbar-gutter:stable;overscroll-behavior:contain}
.oauth-permission{display:grid;grid-template-columns:20px 1fr;gap:10px;align-items:start;padding:12px 0;border-bottom:1px solid var(--oauth-line);cursor:pointer}
.oauth-permission input{position:absolute;opacity:0}.oauth-check{width:18px;height:18px;border:1px solid #b9bfca;border-radius:5px;position:relative}
.oauth-permission input:checked+.oauth-check{background:var(--oauth-accent);border-color:var(--oauth-accent)}
.oauth-permission input:checked+.oauth-check:after{content:"";position:absolute;left:5px;top:2px;width:5px;height:9px;border:solid white;border-width:0 2px 2px 0;transform:rotate(45deg)}
.oauth-permission strong{display:block;font-size:13px;font-weight:650}.oauth-permission small{display:block;color:var(--oauth-muted);font-size:11px;margin-top:2px}.oauth-permission code{display:block;color:var(--oauth-muted);font-size:10px;margin-top:4px;overflow-wrap:anywhere}
.oauth-scope-list{list-style:none;margin:10px 0 0;padding:0;border:1px solid var(--oauth-line);border-radius:10px;overflow:hidden}.oauth-scope-list .oauth-permission{padding:12px 14px}
.oauth-notice{margin-top:18px;color:var(--oauth-muted);font-size:12px}.oauth-cimd{display:inline-block;font-size:11px;color:var(--oauth-muted);background:var(--oauth-soft);padding:4px 8px;border-radius:6px;margin-top:12px;overflow-wrap:anywhere}
.oauth-actions{display:flex;flex-direction:row-reverse;gap:9px;margin-top:22px}.oauth-actions button{border-radius:9px;padding:10px 16px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}.oauth-allow{border:1px solid var(--oauth-accent);background:var(--oauth-accent);color:#fff}.oauth-allow:hover{background:var(--oauth-accent-strong);border-color:var(--oauth-accent-strong)}.oauth-deny{border:1px solid var(--oauth-line);background:transparent;color:var(--oauth-ink)}
.oauth-allow:focus-visible,.oauth-deny:focus-visible,.oauth-permissions summary:focus-visible,.oauth-permission:has(input:focus-visible){outline:3px solid #aaa5ff;outline-offset:3px}
@media(prefers-color-scheme:dark){:root{--oauth-bg:#121318;--oauth-panel:#1b1d24;--oauth-ink:#f4f5f7;--oauth-muted:#9da6b7;--oauth-line:#30333d;--oauth-soft:#292744;--oauth-shadow:#0008}.oauth-avatar{background:#302c55;color:#c9c4ff}}
@media(max-width:560px){body{padding:10px}.oauth-top,.oauth-content{padding-left:20px;padding-right:20px}.oauth-actions{flex-direction:column}.oauth-actions button{width:100%}}
`;

const OAUTH_CONSENT_SCOPE_ROW_TEMPLATE =
  '<label class="oauth-permission"><input type="checkbox" name="{{scopeField}}" value="{{scopeValue}}" checked><span class="oauth-check" aria-hidden="true"></span><span><strong>{{scopeTitle}}</strong><small>{{scopeDetail}}</small><code>{{scopeValue}}</code></span></label>';

const OAUTH_CONSENT_DOCUMENT_TEMPLATE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{pageTitle}}</title><style>{{css}}</style></head>
<body><main class="oauth-shell"><section class="oauth-card">
<header class="oauth-top"><div class="oauth-app"><span class="oauth-mark" aria-label="{{resourceName}}">{{resourceIcon}}</span><span><strong>{{resourceName}}</strong><small>{{clientName}} {{clientSubtitle}}</small></span></div>{{resourceDescription}}
<div class="oauth-hero"><h1>Allow this connection?</h1><p>{{description}}</p><div class="oauth-identity"><span class="oauth-avatar" aria-hidden="true">{{avatar}}</span><span><strong>{{subject}}</strong><small>{{subjectSubtitle}}</small></span></div>{{cimdBadge}}</div></header>
<form method="post" action="{{formAction}}" class="oauth-content"><div class="oauth-section-head"><h2>Access requested</h2>{{editControl}}</div>
<div class="oauth-summary"><span><b>{{scopeSummary}}</b></span><span aria-hidden="true">ⓘ</span></div>{{scopeContent}}
<div class="oauth-notice">You can revoke this connection later from your assistant settings. Only the permissions selected here will be granted.</div>{{hiddenFields}}
<div class="oauth-actions"><button class="oauth-allow" name="{{decisionField}}" value="{{approveValue}}" type="submit">Allow access</button><button class="oauth-deny" name="{{decisionField}}" value="{{denyValue}}" type="submit">Cancel</button></div>
</form></section></main></body></html>`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderResourceIcon(icon: string): string {
  const value = String(icon || '').trim();
  const isImageUrl =
    (value.startsWith('/') && !value.startsWith('//')) ||
    /^https:\/\//i.test(value) ||
    /^data:image\/(?:png|jpeg|gif|webp|avif);/i.test(value);
  if (isImageUrl) {
    return `<img class="oauth-mark-image" src="${escapeHtml(value)}" alt="" aria-hidden="true">`;
  }
  return escapeHtml(value || '⚡');
}

function escapeCss(value: string): string {
  return value.replace(/<\/?style/gi, (match) => match.replace('<', '<\\/'));
}

function humanizeScope(value: string): OAuthConsentScope {
  // OAuth scopes use the standard `resource:operation` namespace; this is not a Photon identity.
  // eslint-disable-next-line no-restricted-syntax -- OAuth scope syntax, not a Photon identity
  const parts = value.split(':');
  const operation = parts.pop() ?? 'use';
  const subject = parts
    .join(' ')
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  const title =
    (operation === 'read' ? 'View ' : operation === 'write' ? 'Manage ' : 'Use ') + subject;
  return {
    value,
    title: title.replace(/\b\w/g, (character) => character.toUpperCase()),
    detail:
      operation === 'read'
        ? 'Read information needed for this connection.'
        : operation === 'write'
          ? 'Make changes or run actions through this connection.'
          : 'Use this capability through the connection.',
  };
}

export function createOAuthConsentViewModel(input: OAuthConsentInput): OAuthConsentViewModel {
  const resourceName = input.resourceName ?? 'Photon';
  return {
    pageTitle: `Connect ${input.clientName}`,
    clientName: input.clientName,
    resourceName,
    resourceIcon: input.resourceIcon ?? '⚡',
    resourceDescription: input.resourceDescription ?? '',
    clientSubtitle: input.clientSubtitle ?? 'wants to connect',
    description:
      input.description ??
      `Review the access ${input.clientName} will have to your ${resourceName} account.`,
    subject: input.subject ?? 'Authenticated account',
    subjectSubtitle: input.subjectSubtitle ?? 'Signed-in account',
    cimdUrl: input.cimdUrl,
    scopes: input.scopeValues.map(humanizeScope),
    formAction: input.formAction,
    transactionField: input.transactionField,
    transactionValue: input.transactionValue,
    decisionField: input.decisionField,
    approveValue: input.approveValue,
    denyValue: input.denyValue,
    hiddenFields: input.hiddenFields ?? [],
    allowScopeSelection: input.allowScopeSelection ?? false,
    customCss: input.customCss,
  };
}

function replaceToken(template: string, token: string, value: string): string {
  return template.split(`{{${token}}}`).join(value);
}

function renderDocument(model: OAuthConsentViewModel, css: string): string {
  const scopes = model.scopes;
  const rows = scopes
    .map((scope) =>
      replaceToken(
        replaceToken(
          replaceToken(
            replaceToken(
              replaceToken(
                replaceToken(
                  OAUTH_CONSENT_SCOPE_ROW_TEMPLATE,
                  'scopeField',
                  model.allowScopeSelection ? 'scope' : 'scope-disabled'
                ),
                'scopeValue',
                escapeHtml(scope.value)
              ),
              'scopeTitle',
              escapeHtml(scope.title)
            ),
            'scopeDetail',
            escapeHtml(scope.detail)
          ),
          'scopeValue',
          escapeHtml(scope.value)
        ),
        'scopeField',
        model.allowScopeSelection ? 'scope' : 'scope-disabled'
      )
    )
    .join('');
  const scopeContent = model.allowScopeSelection
    ? `<details class="oauth-permissions" data-oauth-permissions><summary>Choose individual permissions</summary><div>${rows}</div></details>`
    : scopes.length
      ? `<ul class="oauth-scope-list">${rows.replace(/name="scope-disabled"/g, 'name="scope-disabled" disabled')}</ul>`
      : '<p class="oauth-notice">No specific permissions were requested.</p>';
  const hiddenFields = [
    { name: model.transactionField, value: model.transactionValue },
    ...model.hiddenFields,
  ]
    .map(
      (field) =>
        `<input type="hidden" name="${escapeHtml(field.name)}" value="${escapeHtml(field.value)}">`
    )
    .join('');
  const editControl = '';
  const cimdBadge = model.cimdUrl
    ? `<span class="oauth-cimd">Hosted metadata: ${escapeHtml(model.cimdUrl)}</span>`
    : '';
  let html = OAUTH_CONSENT_DOCUMENT_TEMPLATE;
  const values: Record<string, string> = {
    pageTitle: escapeHtml(model.pageTitle),
    clientName: escapeHtml(model.clientName),
    clientSubtitle: escapeHtml(model.clientSubtitle),
    resourceName: escapeHtml(model.resourceName),
    resourceIcon: renderResourceIcon(model.resourceIcon),
    resourceDescription: model.resourceDescription
      ? `<p class="oauth-resource-description">${escapeHtml(model.resourceDescription)}</p>`
      : '',
    description: escapeHtml(model.description),
    subject: escapeHtml(model.subject),
    subjectSubtitle: escapeHtml(model.subjectSubtitle),
    avatar: escapeHtml(model.subject.charAt(0).toUpperCase() || 'A'),
    cimdBadge,
    formAction: escapeHtml(model.formAction),
    editControl,
    scopeSummary: scopes.length
      ? `${scopes.length} permission${scopes.length === 1 ? '' : 's'} requested`
      : 'No permissions requested',
    scopeContent,
    hiddenFields,
    decisionField: escapeHtml(model.decisionField),
    approveValue: escapeHtml(model.approveValue),
    denyValue: escapeHtml(model.denyValue),
    css: escapeCss(`${css}\n${model.customCss ?? ''}`),
  };
  for (const [token, value] of Object.entries(values)) html = replaceToken(html, token, value);
  return html;
}

export function renderOAuthConsentPage(model: OAuthConsentViewModel): string {
  return renderDocument(model, OAUTH_CONSENT_CSS);
}

export interface OAuthErrorPageInput {
  pageTitle?: string;
  resourceName?: string;
  resourceIcon?: string;
  resourceDescription?: string;
  error: string;
  errorDescription: string;
  customCss?: string;
}

/**
 * Render an OAuth error for a person who reached an authorization endpoint in
 * a browser. OAuth clients still receive the machine-readable JSON response;
 * this page is only for human navigation and recovery from expired flows.
 */
export function renderOAuthErrorPage(input: OAuthErrorPageInput): string {
  const resourceName = input.resourceName ?? 'Photon';
  const resourceIcon = renderResourceIcon(input.resourceIcon ?? '⚡');
  const description = input.errorDescription.toLowerCase().includes('expired')
    ? 'This authorization request expired before it was completed. Return to your assistant and start the connection again.'
    : input.errorDescription;
  const css = `${OAUTH_CONSENT_CSS}
.oauth-error{padding:30px}.oauth-error h1{font-size:25px;letter-spacing:-.035em;line-height:1.15;margin:0 0 8px}.oauth-error p{color:var(--oauth-muted);margin:0}.oauth-error-code{display:inline-block;margin-top:20px;padding:5px 8px;border-radius:6px;background:var(--oauth-soft);color:var(--oauth-muted);font:11px ui-monospace,SFMono-Regular,Menlo,monospace}.oauth-error-actions{margin-top:24px}.oauth-error-actions a{display:inline-flex;align-items:center;justify-content:center;border-radius:9px;padding:10px 16px;background:var(--oauth-accent);color:#fff;font-weight:700;text-decoration:none}
${input.customCss ?? ''}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.pageTitle ?? `${resourceName} connection`)}</title><style>${escapeCss(css)}</style></head><body><main class="oauth-shell"><section class="oauth-card"><header class="oauth-top"><div class="oauth-app"><span class="oauth-mark" aria-label="${escapeHtml(resourceName)}">${resourceIcon}</span><span><strong>${escapeHtml(resourceName)}</strong><small>Secure connection</small></span></div>${input.resourceDescription ? `<p class="oauth-resource-description">${escapeHtml(input.resourceDescription)}</p>` : ''}</header><div class="oauth-error"><h1>Connection could not be completed</h1><p>${escapeHtml(description)}</p><span class="oauth-error-code">${escapeHtml(input.error)}</span><div class="oauth-error-actions"><a href="/">Return to ${escapeHtml(resourceName)}</a></div></div></section></main></body></html>`;
}

/**
 * Emit the renderer used inside generated Workers. Markup and styles come
 * from the same constants used by renderOAuthConsentPage; only the tiny
 * serialization wrapper is generated for the Worker runtime.
 */
export function renderOAuthConsentRuntimeSource(functionName = 'photonOAuthRenderConsent'): string {
  return `
const photonOAuthConsentCss = ${JSON.stringify(OAUTH_CONSENT_CSS)};
const photonOAuthConsentDocument = ${JSON.stringify(OAUTH_CONSENT_DOCUMENT_TEMPLATE)};
const photonOAuthConsentScopeRow = ${JSON.stringify(OAUTH_CONSENT_SCOPE_ROW_TEMPLATE)};
function ${functionName}Escape(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function ${functionName}ResourceIcon(icon) {
  const value = String(icon || '').trim();
  const lower = value.toLowerCase();
  const isDataImage = ['data:image/png;', 'data:image/jpeg;', 'data:image/gif;', 'data:image/webp;', 'data:image/avif;'].some((prefix) => lower.startsWith(prefix));
  const isImageUrl = (value.startsWith('/') && !value.startsWith('//')) || lower.startsWith('https://') || isDataImage;
  return isImageUrl ? '<img class="oauth-mark-image" src="' + ${functionName}Escape(value) + '" alt="" aria-hidden="true">' : ${functionName}Escape(value || '⚡');
}
function ${functionName}Css(value) { return String(value || '').replace(/<\\/?style/gi, (match) => match.replace('<', '<\\\\/')); }
function ${functionName}Scope(value) {
  const parts = String(value).split(':');
  const operation = parts.pop() || 'use';
  const subject = parts.join(' ').replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return { value: String(value), title: ((operation === 'read' ? 'View ' : operation === 'write' ? 'Manage ' : 'Use ') + subject).replace(/\\b\\w/g, (character) => character.toUpperCase()), detail: operation === 'read' ? 'Read information needed for this connection.' : operation === 'write' ? 'Make changes or run actions through this connection.' : 'Use this capability through the connection.' };
}
function ${functionName}Replace(template, token, value) { return template.split('{{' + token + '}}').join(value); }
function ${functionName}(model) {
  const scopes = (Array.isArray(model.scopes) ? model.scopes : []).map((scope) => typeof scope === 'string' ? ${functionName}Scope(scope) : scope);
  const rows = scopes.map((scope) => {
    let row = photonOAuthConsentScopeRow;
    row = ${functionName}Replace(row, 'scopeField', model.allowScopeSelection ? 'scope' : 'scope-disabled');
    row = ${functionName}Replace(row, 'scopeValue', ${functionName}Escape(scope.value));
    row = ${functionName}Replace(row, 'scopeTitle', ${functionName}Escape(scope.title));
    row = ${functionName}Replace(row, 'scopeDetail', ${functionName}Escape(scope.detail));
    return row;
  }).join('');
  const scopeContent = model.allowScopeSelection ? '<details class="oauth-permissions" data-oauth-permissions><summary>Choose individual permissions</summary><div>' + rows + '</div></details>' : scopes.length ? '<ul class="oauth-scope-list">' + rows.replace(/name="scope-disabled"/g, 'name="scope-disabled" disabled') + '</ul>' : '<p class="oauth-notice">No specific permissions were requested.</p>';
  const hiddenFields = [{ name: model.transactionField, value: model.transactionValue }].concat(model.hiddenFields || []).map((field) => '<input type="hidden" name="' + ${functionName}Escape(field.name) + '" value="' + ${functionName}Escape(field.value) + '">').join('');
  const editControl = '';
  let html = photonOAuthConsentDocument;
  const values = {
    pageTitle: ${functionName}Escape(model.pageTitle), clientName: ${functionName}Escape(model.clientName), clientSubtitle: ${functionName}Escape(model.clientSubtitle || 'wants to connect'), resourceName: ${functionName}Escape(model.resourceName || 'Photon'), resourceIcon: ${functionName}ResourceIcon(model.resourceIcon || '⚡'), resourceDescription: model.resourceDescription ? '<p class="oauth-resource-description">' + ${functionName}Escape(model.resourceDescription) + '</p>' : '', description: ${functionName}Escape(model.description), subject: ${functionName}Escape(model.subject), subjectSubtitle: ${functionName}Escape(model.subjectSubtitle), avatar: ${functionName}Escape((String(model.subject || '').charAt(0).toUpperCase() || 'A')), cimdBadge: model.cimd ? '<span class="oauth-cimd">Hosted metadata: ' + ${functionName}Escape(model.cimd) + '</span>' : '', formAction: ${functionName}Escape(model.formAction), editControl, scopeSummary: scopes.length ? scopes.length + ' permission' + (scopes.length === 1 ? '' : 's') + ' requested' : 'No permissions requested', scopeContent, hiddenFields, decisionField: ${functionName}Escape(model.decisionField), approveValue: ${functionName}Escape(model.approveValue), denyValue: ${functionName}Escape(model.denyValue), css: ${functionName}Css(photonOAuthConsentCss + '\\n' + (model.customCss || ''))
  };
  for (const key of Object.keys(values)) html = ${functionName}Replace(html, key, values[key]);
  return html;
}
function ${functionName}Error(model) {
  const resourceName = model.resourceName || 'Photon';
  const description = String(model.errorDescription || '').toLowerCase().includes('expired') ? 'This authorization request expired before it was completed. Return to your assistant and start the connection again.' : String(model.errorDescription || 'The authorization request could not be completed.');
  const css = photonOAuthConsentCss + '\\n.oauth-error{padding:30px}.oauth-error h1{font-size:25px;letter-spacing:-.035em;line-height:1.15;margin:0 0 8px}.oauth-error p{color:var(--oauth-muted);margin:0}.oauth-error-code{display:inline-block;margin-top:20px;padding:5px 8px;border-radius:6px;background:var(--oauth-soft);color:var(--oauth-muted);font:11px ui-monospace,SFMono-Regular,Menlo,monospace}.oauth-error-actions{margin-top:24px}.oauth-error-actions a{display:inline-flex;align-items:center;justify-content:center;border-radius:9px;padding:10px 16px;background:var(--oauth-accent);color:#fff;font-weight:700;text-decoration:none}\\n' + (model.customCss || '');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + ${functionName}Escape(model.pageTitle || (resourceName + ' connection')) + '</title><style>' + ${functionName}Css(css) + '</style></head><body><main class="oauth-shell"><section class="oauth-card"><header class="oauth-top"><div class="oauth-app"><span class="oauth-mark" aria-label="' + ${functionName}Escape(resourceName) + '">' + ${functionName}ResourceIcon(model.resourceIcon || '⚡') + '</span><span><strong>' + ${functionName}Escape(resourceName) + '</strong><small>Secure connection</small></span></div>' + (model.resourceDescription ? '<p class="oauth-resource-description">' + ${functionName}Escape(model.resourceDescription) + '</p>' : '') + '</header><div class="oauth-error"><h1>Connection could not be completed</h1><p>' + ${functionName}Escape(description) + '</p><span class="oauth-error-code">' + ${functionName}Escape(model.error || 'oauth_error') + '</span><div class="oauth-error-actions"><a href="/">Return to ' + ${functionName}Escape(resourceName) + '</a></div></div></section></main></body></html>';
}
`;
}
