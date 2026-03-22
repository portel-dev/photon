import { css } from 'lit';

/**
 * Universal motion primitives for Beam UI
 *
 * Any element can declare enter/exit/depth behavior via data attributes
 * or CSS classes. These are not slide-specific — they work everywhere:
 * result panels, dashboard cards, sidebar items, format blocks, slides.
 *
 * Usage:
 *   <div data-enter="fade-in">            — animate on DOM insertion
 *   <div data-exit="zoom-out">            — animate on DOM removal
 *   <div data-depth="tilt(-5, 2)">        — CSS perspective transform
 *   <div class="motion-fade-in">          — direct class usage
 *   <div class="motion-stagger">          — stagger children sequentially
 *
 * Reduced motion: all effects are disabled when prefers-reduced-motion is set.
 */
export const motion = css`
  /* ═══ TIMING TOKENS ═══ */
  :host {
    --motion-fast: 0.15s;
    --motion-normal: 0.3s;
    --motion-slow: 0.5s;
    --motion-slower: 0.8s;
    --motion-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --motion-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
    --motion-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  /* ═══ ENTER ANIMATIONS ═══ */

  @keyframes motion-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes motion-slide-up {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes motion-slide-down {
    from {
      opacity: 0;
      transform: translateY(-16px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes motion-slide-in-right {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  @keyframes motion-slide-in-left {
    from {
      opacity: 0;
      transform: translateX(-20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  @keyframes motion-scale-in {
    from {
      opacity: 0;
      transform: scale(0.92);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes motion-scale-up {
    from {
      opacity: 0;
      transform: scale(0.5);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes motion-flip-in {
    from {
      opacity: 0;
      transform: perspective(800px) rotateY(90deg);
    }
    to {
      opacity: 1;
      transform: perspective(800px) rotateY(0deg);
    }
  }

  @keyframes motion-drop-in {
    from {
      opacity: 0;
      transform: translateY(-40px) scale(0.95);
    }
    60% {
      opacity: 1;
      transform: translateY(4px) scale(1.01);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* ═══ EXIT ANIMATIONS ═══ */

  @keyframes motion-fade-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  @keyframes motion-slide-out-down {
    from {
      opacity: 1;
      transform: translateY(0);
    }
    to {
      opacity: 0;
      transform: translateY(16px);
    }
  }

  @keyframes motion-scale-out {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.92);
    }
  }

  @keyframes motion-zoom-out {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.5);
    }
  }

  @keyframes motion-flip-out {
    from {
      opacity: 1;
      transform: perspective(800px) rotateY(0deg);
    }
    to {
      opacity: 0;
      transform: perspective(800px) rotateY(-90deg);
    }
  }

  /* ═══ PERSISTENT EFFECTS ═══ */

  @keyframes motion-float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-6px);
    }
  }

  @keyframes motion-pulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.03);
    }
  }

  @keyframes motion-glow {
    0%,
    100% {
      box-shadow: 0 0 0 0 var(--glow-primary, rgba(100, 180, 255, 0));
    }
    50% {
      box-shadow: 0 0 12px 2px var(--glow-primary, rgba(100, 180, 255, 0.3));
    }
  }

  /* ═══ ENTER CLASSES ═══ */

  .motion-fade-in {
    animation: motion-fade-in var(--motion-normal) var(--motion-ease-out) both;
  }

  .motion-slide-up {
    animation: motion-slide-up var(--motion-normal) var(--motion-ease-out) both;
  }

  .motion-slide-down {
    animation: motion-slide-down var(--motion-normal) var(--motion-ease-out) both;
  }

  .motion-slide-in-right {
    animation: motion-slide-in-right var(--motion-normal) var(--motion-ease-out) both;
  }

  .motion-slide-in-left {
    animation: motion-slide-in-left var(--motion-normal) var(--motion-ease-out) both;
  }

  .motion-scale-in {
    animation: motion-scale-in var(--motion-normal) var(--motion-ease-out) both;
  }

  .motion-scale-up {
    animation: motion-scale-up var(--motion-normal) var(--motion-ease-spring) both;
  }

  .motion-flip-in {
    animation: motion-flip-in var(--motion-slow) var(--motion-ease-out) both;
  }

  .motion-drop-in {
    animation: motion-drop-in var(--motion-slow) var(--motion-ease-out) both;
  }

  /* ═══ EXIT CLASSES ═══ */

  .motion-fade-out {
    animation: motion-fade-out var(--motion-normal) var(--motion-ease-in-out) both;
  }

  .motion-slide-out-down {
    animation: motion-slide-out-down var(--motion-normal) var(--motion-ease-in-out) both;
  }

  .motion-scale-out {
    animation: motion-scale-out var(--motion-normal) var(--motion-ease-in-out) both;
  }

  .motion-zoom-out {
    animation: motion-zoom-out var(--motion-normal) var(--motion-ease-in-out) both;
  }

  .motion-flip-out {
    animation: motion-flip-out var(--motion-slow) var(--motion-ease-in-out) both;
  }

  /* ═══ PERSISTENT CLASSES ═══ */

  .motion-float {
    animation: motion-float 3s ease-in-out infinite;
  }

  .motion-pulse {
    animation: motion-pulse 2s ease-in-out infinite;
  }

  .motion-glow {
    animation: motion-glow 2s ease-in-out infinite;
  }

  /* ═══ STAGGER ═══ */

  .motion-stagger > * {
    animation: motion-slide-up var(--motion-normal) var(--motion-ease-out) both;
  }

  .motion-stagger > *:nth-child(1) {
    animation-delay: 0ms;
  }
  .motion-stagger > *:nth-child(2) {
    animation-delay: 50ms;
  }
  .motion-stagger > *:nth-child(3) {
    animation-delay: 100ms;
  }
  .motion-stagger > *:nth-child(4) {
    animation-delay: 150ms;
  }
  .motion-stagger > *:nth-child(5) {
    animation-delay: 200ms;
  }
  .motion-stagger > *:nth-child(6) {
    animation-delay: 250ms;
  }
  .motion-stagger > *:nth-child(7) {
    animation-delay: 300ms;
  }
  .motion-stagger > *:nth-child(8) {
    animation-delay: 350ms;
  }
  .motion-stagger > *:nth-child(9) {
    animation-delay: 400ms;
  }
  .motion-stagger > *:nth-child(10) {
    animation-delay: 450ms;
  }
  .motion-stagger > *:nth-child(n + 11) {
    animation-delay: 500ms;
  }

  .motion-stagger-fast > * {
    animation: motion-fade-in var(--motion-fast) var(--motion-ease-out) both;
  }

  .motion-stagger-fast > *:nth-child(1) {
    animation-delay: 0ms;
  }
  .motion-stagger-fast > *:nth-child(2) {
    animation-delay: 30ms;
  }
  .motion-stagger-fast > *:nth-child(3) {
    animation-delay: 60ms;
  }
  .motion-stagger-fast > *:nth-child(4) {
    animation-delay: 90ms;
  }
  .motion-stagger-fast > *:nth-child(5) {
    animation-delay: 120ms;
  }
  .motion-stagger-fast > *:nth-child(n + 6) {
    animation-delay: 150ms;
  }

  /* ═══ DEPTH / PERSPECTIVE ═══ */

  .motion-perspective {
    perspective: 1200px;
    perspective-origin: center;
  }

  .motion-depth-front {
    transform: translateZ(30px);
  }

  .motion-depth-back {
    transform: translateZ(-20px) scale(1.04);
    filter: blur(0.5px);
    opacity: 0.85;
  }

  .motion-depth-float {
    transform: translateZ(15px);
    filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.25));
  }

  .motion-tilt {
    transform: rotateY(-5deg) rotateX(2deg);
    transition: transform var(--motion-slow) var(--motion-ease-out);
  }

  .motion-tilt:hover {
    transform: rotateY(0deg) rotateX(0deg);
  }

  .motion-tilt-right {
    transform: rotateY(5deg) rotateX(2deg);
    transition: transform var(--motion-slow) var(--motion-ease-out);
  }

  .motion-tilt-right:hover {
    transform: rotateY(0deg) rotateX(0deg);
  }

  /* ═══ MATTE TRANSITIONS ═══ */

  .motion-matte-reveal {
    mask-size: 0% auto;
    mask-repeat: no-repeat;
    mask-position: center;
    animation: motion-matte-wipe var(--motion-slower) var(--motion-ease-out) forwards;
  }

  @keyframes motion-matte-wipe {
    to {
      mask-size: 300% auto;
    }
  }

  .motion-matte-radial {
    mask-image: radial-gradient(circle, white, black);
    mask-size: 0% 0%;
    mask-position: center;
    mask-repeat: no-repeat;
    animation: motion-matte-radial-reveal var(--motion-slower) var(--motion-ease-out) forwards;
  }

  @keyframes motion-matte-radial-reveal {
    to {
      mask-size: 200% 200%;
    }
  }

  .motion-matte-diagonal {
    mask-image: linear-gradient(135deg, white 0%, black 100%);
    mask-size: 300% 300%;
    mask-position: 100% 100%;
    animation: motion-matte-diagonal-reveal var(--motion-slower) var(--motion-ease-out) forwards;
  }

  @keyframes motion-matte-diagonal-reveal {
    to {
      mask-position: 0% 0%;
    }
  }

  /* ═══ SLIDE TRANSITIONS (for @format slides) ═══ */

  .motion-slide-transition-fade {
    view-transition-name: slide-content;
  }

  /* ═══ REDUCED MOTION ═══ */

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }

    .motion-float,
    .motion-pulse,
    .motion-glow {
      animation: none !important;
    }
  }
`;
