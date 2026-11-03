/** Tiny argv helpers for the eval CLIs: `--name value` and `--flag`. */
export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? undefined : v;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function list(name: string): string[] | undefined {
  const v = arg(name);
  return v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
}
