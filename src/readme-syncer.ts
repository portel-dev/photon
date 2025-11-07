import { existsSync } from 'fs';
import * as fs from 'fs/promises';

const MARKER_START = '<!-- PHOTON_MARKETPLACE_START -->';
const MARKER_END = '<!-- PHOTON_MARKETPLACE_END -->';

/**
 * Syncs README.md with auto-generated photon list while preserving user content
 *
 * Uses HTML comment markers to identify auto-generated sections.
 * Content outside markers is preserved on each sync.
 */
export class ReadmeSyncer {
  constructor(private readmePath: string) {}

  /**
   * Sync README with generated content
   *
   * @param generatedContent - The auto-generated markdown to insert
   * @returns true if README was updated, false if created new
   */
  async sync(generatedContent: string): Promise<boolean> {
    const markedContent = `${MARKER_START}\n${generatedContent}\n${MARKER_END}`;

    if (!existsSync(this.readmePath)) {
      // No existing README - create new one
      await fs.writeFile(this.readmePath, markedContent, 'utf-8');
      return false;
    }

    // README exists - preserve user content
    const existing = await fs.readFile(this.readmePath, 'utf-8');
    const updated = this.replaceMarkedSection(existing, generatedContent);

    await fs.writeFile(this.readmePath, updated, 'utf-8');
    return true;
  }

  /**
   * Replace content between markers, preserving everything else
   */
  private replaceMarkedSection(existing: string, newContent: string): string {
    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);

    if (startIdx === -1 || endIdx === -1) {
      // Markers not found - append at end with proper spacing
      const separator = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
      return existing + separator + MARKER_START + '\n' + newContent + '\n' + MARKER_END + '\n';
    }

    // Extract content before and after markers
    const before = existing.substring(0, startIdx);
    const after = existing.substring(endIdx + MARKER_END.length);

    // Ensure proper spacing
    const beforeTrimmed = before.trimEnd();
    const afterTrimmed = after.trimStart();

    const beforeSeparator = beforeTrimmed ? '\n\n' : '';
    const afterSeparator = afterTrimmed ? '\n\n' : '\n';

    return (
      beforeTrimmed +
      beforeSeparator +
      MARKER_START +
      '\n' +
      newContent +
      '\n' +
      MARKER_END +
      afterSeparator +
      afterTrimmed
    );
  }

  /**
   * Check if README has marked section
   */
  async hasMarkers(): Promise<boolean> {
    if (!existsSync(this.readmePath)) {
      return false;
    }

    const content = await fs.readFile(this.readmePath, 'utf-8');
    return content.includes(MARKER_START) && content.includes(MARKER_END);
  }

  /**
   * Extract user content (everything outside markers)
   */
  async extractUserContent(): Promise<{ before: string; after: string } | null> {
    if (!existsSync(this.readmePath)) {
      return null;
    }

    const content = await fs.readFile(this.readmePath, 'utf-8');
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);

    if (startIdx === -1 || endIdx === -1) {
      return { before: content, after: '' };
    }

    return {
      before: content.substring(0, startIdx).trimEnd(),
      after: content.substring(endIdx + MARKER_END.length).trimStart(),
    };
  }
}
