# Webhooks

Photon methods can receive HTTP webhook callbacks from external services. Webhook methods are exposed as POST endpoints on the daemon.

## URL Pattern

```
POST /webhook/{photonName}/{method}
```

For example, a photon named `forms` with a method `handleSubmission` is reachable at:

```
POST /webhook/forms/handleSubmission
```

## Declaration

### `handle*` Prefix

Any method starting with `handle` is automatically treated as a webhook handler:

```typescript
async handleStripeEvent(params: { type: string; data: object }) {
  // Automatically exposed as POST /webhook/{photon}/handleStripeEvent
}
```

### `@webhook` JSDoc Tag

Explicitly mark a method as a webhook handler:

```typescript
/**
 * Process form submission
 * @webhook
 */
async processForm(params: { email: string; name: string }) {
  // Exposed as POST /webhook/{photon}/processForm
}
```

With a custom path:

```typescript
/**
 * GitHub push events
 * @webhook github/push
 */
async onPush(params: { ref: string; commits: object[] }) {
  // Exposed at the custom path
}
```

The `@webhook` tag takes precedence over the `handle*` prefix when both are present.

## Webhook Metadata

Webhook methods receive HTTP context via the `_webhook` metadata field on the params object:

```typescript
interface WebhookMetadata {
  method: string;       // HTTP method (always 'POST')
  headers: Record<string, string>;  // Request headers
  query: Record<string, string>;    // URL query parameters
  timestamp: number;    // Unix timestamp of request receipt
}
```

Access it in your handler:

```typescript
async handleEvent(params: { type: string; _webhook: WebhookMetadata }) {
  const signature = params._webhook.headers['x-hub-signature-256'];
  const receivedAt = new Date(params._webhook.timestamp);
  // ...
}
```

## Authentication

Set the `PHOTON_WEBHOOK_SECRET` environment variable to require authentication on all webhook endpoints:

```bash
export PHOTON_WEBHOOK_SECRET=whsec_abc123...
```

Callers must include the secret in the `X-Webhook-Secret` header:

```bash
curl -X POST https://example.com/webhook/forms/handleSubmission \
  -H "X-Webhook-Secret: whsec_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "name": "Alice"}'
```

Requests without a valid secret receive a `401 Unauthorized` response.

## Example: Form Submission Handler

```typescript
import { Photon } from '@anthropic/photon';

class FormHandler extends Photon {
  /**
   * Handle contact form submission
   * @webhook
   * @param email Submitter email
   * @param name Submitter name
   * @param message Form message
   */
  async handleContactForm(params: {
    email: string;
    name: string;
    message: string;
    _webhook: { method: string; headers: Record<string, string>; query: Record<string, string>; timestamp: number };
  }) {
    // Verify the request came recently
    const age = Date.now() - params._webhook.timestamp;
    if (age > 60_000) {
      throw new Error('Request too old');
    }

    await this.saveSubmission({
      email: params.email,
      name: params.name,
      message: params.message,
      receivedAt: new Date(params._webhook.timestamp),
    });

    return { success: true };
  }
}
```
