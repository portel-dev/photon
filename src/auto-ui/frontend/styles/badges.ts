import { css } from 'lit';

export const badges = css`
  .type-badge {
    display: inline-block;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: var(--radius-xs);
  }

  .type-badge.autorun {
    background: hsla(160, 60%, 45%, 0.15);
    color: hsl(160, 60%, 55%);
  }

  .type-badge.webhook {
    background: hsla(45, 80%, 50%, 0.15);
    color: hsl(45, 80%, 60%);
  }

  .type-badge.cron {
    background: hsla(215, 80%, 60%, 0.15);
    color: hsl(215, 80%, 70%);
  }

  .type-badge.locked {
    background: hsla(0, 65%, 55%, 0.15);
    color: hsl(0, 65%, 65%);
  }

  .type-badge.stateful {
    background: hsla(263, 70%, 60%, 0.15);
    color: hsl(263, 70%, 70%);
  }

  .param-tag {
    font-size: 0.65rem;
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    background: var(--param-tag-bg, hsla(220, 10%, 80%, 0.08));
    color: var(--param-tag-color, var(--t-muted));
    font-family: var(--font-mono);
    white-space: nowrap;
  }
`;
