import { css } from 'lit';

export const forms = css`
  input,
  textarea,
  select {
    width: 100%;
    background: var(--bg-glass);
    border: 1px solid var(--border-glass);
    color: var(--t-primary);
    padding: var(--space-sm);
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    box-sizing: border-box;
  }

  ::placeholder {
    color: var(--t-muted);
    opacity: 0.6;
  }

  .form-group {
    margin-bottom: var(--space-md);
  }

  .form-group label {
    display: block;
    margin-bottom: var(--space-xs);
    font-weight: 500;
    font-size: 0.9rem;
  }

  .error-text {
    color: var(--color-error);
    font-size: 0.75rem;
    margin-top: var(--space-xs);
  }

  input.error,
  textarea.error,
  select.error {
    border-color: var(--color-error);
  }

  input.error:focus-visible,
  textarea.error:focus-visible {
    box-shadow: 0 0 0 2px var(--color-error-glow);
  }
`;
