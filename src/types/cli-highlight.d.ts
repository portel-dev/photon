declare module 'cli-highlight' {
  interface HighlightOptions {
    language?: string;
    ignoreIllegals?: boolean;
  }

  export function highlight(value: string, options?: HighlightOptions): string;
}
