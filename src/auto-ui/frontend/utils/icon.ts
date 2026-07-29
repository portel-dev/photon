/**
 * Photon metadata accepts icon names for other consumers, but Beam renders
 * photon icons as text. Only use values that are actually visual glyphs in
 * that text slot; names such as "image" or "rocket" should fall back to the
 * photon initials instead of being displayed as clipped UI text.
 */
export function isEmojiIcon(icon: string | undefined): boolean {
  return !!icon && /\p{Extended_Pictographic}/u.test(icon);
}
