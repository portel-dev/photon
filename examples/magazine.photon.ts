/**
 * Magazine
 *
 * Rich article layout with text flowing around images.
 * Demonstrates @format article powered by Pretext text layout engine.
 */
export default class Magazine {
  /**
   * A sample article with images
   * @format article
   */
  sample() {
    return {
      text: `The future of user interfaces is being shaped by a convergence of AI-native design patterns and precision text layout engines. Traditional web rendering relies on the browser's CSS layout engine, which requires DOM reflow — an expensive operation that becomes a bottleneck when interfaces need to update at 60fps in response to streaming AI output.

Modern text layout libraries solve this by separating measurement from rendering. The measurement phase uses the browser's font engine via Canvas to compute exact text dimensions, segment boundaries, and line break opportunities. The layout phase is pure arithmetic — given cached measurements, it can compute heights, line counts, and positions in microseconds rather than the milliseconds that DOM reflow requires.

This two-phase architecture unlocks capabilities that were previously impractical in web UIs. Text can flow around arbitrarily shaped obstacles, not just rectangular floats. Multi-column layouts can be perfectly balanced without trial-and-error rendering. Font sizes can be computed to fit text precisely within a fixed area, enabling responsive typography that adapts to any viewport.

For AI-driven interfaces, where structured data streams in real-time, this means the UI can re-layout instantly as new content arrives — without the visual jank of DOM reflow. Charts, tables, and interactive elements can be embedded inline with flowing text, creating magazine-quality layouts that update live.

The implications extend beyond performance. When text layout becomes a pure function of (content, width, font) → positions, it becomes composable. You can preview layouts server-side, cache layout results, diff layouts efficiently, and even animate between layout states smoothly. The UI becomes a function of data, not an artifact of DOM mutation.`,
      images: [
        {
          url: 'https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?w=400&h=300&fit=crop',
          width: 280,
          height: 210,
          position: 'right' as const,
          caption: 'AI-native interfaces render at 60fps',
        },
        {
          url: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=400&h=300&fit=crop',
          width: 260,
          height: 195,
          position: 'left' as const,
          caption: 'Text flows around embedded elements',
        },
      ],
    };
  }

  /**
   * Text-only article with automatic two-column layout
   * @format article
   */
  editorial() {
    return {
      text: `In the early days of the web, text was simply poured into a single column and left to the browser's default rendering. There was no concept of magazine-style layouts, flowing text, or precision typography. The web was a document viewer, not a design surface.

CSS brought columns, floats, and eventually grid and flexbox. But these tools operate at the box level — they position containers, not individual lines of text. When you float an image, CSS wraps text around its bounding box. You cannot flow text along a curved path, balance columns to the line, or compute the tightest width that fits a given number of lines.

The gap between print typography and web typography has persisted for decades. Print layout engines like InDesign compute text positions with sub-pixel precision, support optical margin alignment, and flow text around arbitrary shapes. Web browsers, constrained by the DOM's box model and real-time reflow requirements, have never matched this level of typographic control.

A new generation of JavaScript text layout libraries is closing this gap. By measuring text via Canvas (which uses the same font engine as the DOM) and computing layouts with pure math, these libraries achieve print-quality precision in the browser. The key insight is separation: measure once (expensive), layout many times (cheap). A single prepare() call computes all segment widths and break opportunities. Subsequent layout() calls are arithmetic only — no DOM, no reflow, no jank.

This architecture is particularly powerful for dynamic content. When an AI generates text in real-time, the layout engine can re-flow text around newly inserted images or data visualizations without touching the DOM until the final frame. The result is fluid, responsive layouts that feel as polished as a printed magazine but update like a real-time dashboard.`,
    };
  }
}
