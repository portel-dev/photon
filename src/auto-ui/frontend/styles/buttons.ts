import { css } from 'lit';

export const buttons = css`
  button {
    padding: var(--space-sm) var(--space-lg);
    border-radius: var(--radius-sm);
    font-weight: 500;
    cursor: pointer;
    border: none;
    font-family: var(--font-sans);
    transition: all 0.2s;
  }

  .btn-primary {
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    color: white;
  }

  .btn-primary:hover {
    opacity: 0.9;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px var(--glow-primary);
  }

  .btn-secondary {
    background: transparent;
    color: var(--t-muted);
    border: 1px solid var(--border-glass);
  }

  .btn-secondary:hover {
    background: hsla(220, 10%, 80%, 0.1);
    color: var(--t-primary);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  .btn-loading {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;
