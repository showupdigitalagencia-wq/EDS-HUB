// Ambient types for Deno runtime in shared edge function files
declare namespace Deno {
  export const env: {
    get(key: string): string | undefined;
    set?(key: string, value: string): void;
    toObject?(): Record<string, string>;
  };
}
