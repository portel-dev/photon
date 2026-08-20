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
      clientSubtitle: 'wants to connect',
      resourceName: '<Consult Arul>',
      resourceIcon: '🗓️',
      resourceDescription: 'Book a focused consultation with Arul.',
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
    expect(html).toContain('.oauth-shell{width:min(100%,720px);max-height:calc(100vh - 48px)}');
    expect(html).toContain('.oauth-card{display:flex;flex-direction:column;max-height:inherit');
    expect(html).toContain('.oauth-content{min-height:0;overflow:auto');
    expect(html).toContain('&lt;Assistant&gt;');
    expect(html).toContain('&lt;Consult Arul&gt;');
    expect(html).toContain('aria-label="&lt;Consult Arul&gt;"');
    expect(html).toContain('🗓️');
    expect(html).toContain('Book a focused consultation with Arul.');
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
    expect(html).toContain('<summary>Choose individual permissions</summary>');
    expect(html).toContain('max-height:min(42vh,360px)');
    expect(html).toContain('overflow-y:auto');
    expect(html).not.toContain('<script>');
    expect(html).toContain('name="tx" value="tx-1"');
    expect(html).toContain('name="action" value="approve"');
  });

  it('renders URL icons as images without allowing unsafe markup', () => {
    const imageModel = createOAuthConsentViewModel({
      clientName: 'ChatGPT',
      resourceName: 'Consult Arul',
      resourceIcon: 'https://consult.arul.sg/consult-icon.svg',
      scopeValues: [],
      formAction: '/consent',
      transactionField: 'tx',
      transactionValue: 'tx-1',
      decisionField: 'action',
      approveValue: 'approve',
      denyValue: 'deny',
    });
    const imageHtml = renderOAuthConsentPage(imageModel);
    expect(imageHtml).toContain('class="oauth-mark-image"');
    expect(imageHtml).toContain('src="https://consult.arul.sg/consult-icon.svg"');
    expect(imageHtml).not.toContain('>https://consult.arul.sg/consult-icon.svg<');

    const unsafeModel = createOAuthConsentViewModel({
      clientName: 'ChatGPT',
      resourceIcon: 'javascript:alert(1)',
      scopeValues: [],
      formAction: '/consent',
      transactionField: 'tx',
      transactionValue: 'tx-1',
      decisionField: 'action',
      approveValue: 'approve',
      denyValue: 'deny',
    });
    const unsafeHtml = renderOAuthConsentPage(unsafeModel);
    expect(unsafeHtml).not.toContain('src="javascript:alert(1)"');
    expect(unsafeHtml).toContain('javascript:alert(1)');
  });

  it('embeds the exact shared CSS and markup source for generated Workers', () => {
    const runtime = renderOAuthConsentRuntimeSource();

    expect(runtime).toContain('const photonOAuthConsentCss');
    expect(runtime).toContain('.oauth-card');
    expect(runtime).toContain('photonOAuthConsentDocument');
    expect(runtime).toContain('photonOAuthConsentScopeRow');
    expect(runtime).toContain('function photonOAuthRenderConsent(model)');
    expect(runtime).toContain('function photonOAuthRenderConsentResourceIcon(icon)');
    expect(runtime).toContain('oauth-mark-image');
  });
});
