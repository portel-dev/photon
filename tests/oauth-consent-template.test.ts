import { describe, expect, it } from 'vitest';
import {
  createOAuthConsentViewModel,
  renderOAuthConsentPage,
  renderOAuthConsentRuntimeSource,
} from '../src/serv/auth/oauth-consent.js';

describe('shared OAuth consent presentation', () => {
  it('renders the local consent form with escaped model values and preserved fields', () => {
    const model = createOAuthConsentViewModel({
      clientName: '<Assistant>',
      clientSubtitle: 'wants to connect to <Photon>',
      description: 'Review <access> & permissions.',
      subject: 'user@example.test',
      cimdUrl: 'https://client.example.test/metadata',
      scopeValues: ['bookings:read'],
      formAction: '?req=tx-1',
      transactionField: 'req',
      transactionValue: 'tx-1',
      decisionField: 'decision',
      approveValue: 'approve',
      denyValue: 'deny',
      customCss: '.brand{color:rebeccapurple}</style><script>blocked()</script>',
    });

    const html = renderOAuthConsentPage(model);

    expect(html).toContain('oauth-card');
    expect(html).toContain('&lt;Assistant&gt;');
    expect(html).toContain('name="req" value="tx-1"');
    expect(html).toContain('name="decision" value="approve"');
    expect(html).toContain('name="decision" value="deny"');
    expect(html).toContain('bookings:read');
    expect(html).toContain('Hosted metadata: https://client.example.test/metadata');
    expect(html).toContain('.brand{color:rebeccapurple}');
    expect(html).not.toContain('</style><script>blocked()');
    expect(html).not.toContain('https://cdn');
  });

  it('renders selectable scopes with the Cloudflare form contract', () => {
    const model = createOAuthConsentViewModel({
      clientName: 'Claude',
      scopeValues: ['bookings:read', 'availability:write'],
      formAction: '/consent',
      transactionField: 'tx',
      transactionValue: 'tx-1',
      decisionField: 'action',
      approveValue: 'approve',
      denyValue: 'deny',
      allowScopeSelection: true,
    });

    const html = renderOAuthConsentPage(model);

    expect(html).toContain('name="scope" value="bookings:read" checked');
    expect(html).toContain('name="scope" value="availability:write" checked');
    expect(html).toContain('data-oauth-permissions');
    expect(html).toContain('name="tx" value="tx-1"');
    expect(html).toContain('name="action" value="approve"');
  });

  it('embeds the exact shared CSS and markup source for generated Workers', () => {
    const runtime = renderOAuthConsentRuntimeSource();

    expect(runtime).toContain('const photonOAuthConsentCss');
    expect(runtime).toContain('.oauth-card');
    expect(runtime).toContain('photonOAuthConsentDocument');
    expect(runtime).toContain('photonOAuthConsentScopeRow');
    expect(runtime).toContain('function photonOAuthRenderConsent(model)');
  });
});
