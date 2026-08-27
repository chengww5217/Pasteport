/**
 * The cross-platform clipboard contract.
 *
 * Each platform reader is a separate program in a separate language (JXA on
 * macOS, PowerShell on Windows, wl-paste/xclip on Linux) — there is no code to
 * share between them. What they do share is this JSON shape, which is the only
 * thing the rest of the extension knows about:
 *
 *   { "kind": "files", "paths": ["/abs/one", "/abs/two"] }
 *   { "kind": "image", "paths": ["/abs/staged.png"] }
 *   { "kind": "other", "types": ["public.utf8-plain-text"] }
 *   { "kind": "error", "message": "..." }
 *
 * Pure module: parsing is unit tested without spawning anything.
 */

export interface ClipboardFiles {
  kind: 'files';
  /** Absolute local paths of user-owned files; the extension must not delete these. */
  paths: string[];
}

export interface ClipboardImage {
  kind: 'image';
  /** Absolute local paths of files the reader staged; owned by the extension. */
  paths: string[];
}

export interface ClipboardOther {
  kind: 'other';
  /** Platform type identifiers, for the log only. */
  types: string[];
}

/**
 * A fix the extension knows how to carry out, described by the reader rather
 * than performed by it: the reader knows what is missing, the UI layer decides
 * how to ask.
 */
export interface InstallPackagesRemedy {
  kind: 'installPackages';
  /** Distribution package names, identical across the mainstream distros. */
  packages: string[];
}

/**
 * Identifies the errors worth showing to the user, so the UI layer can put a
 * translated sentence in front of them.
 *
 * The readers cannot do that themselves: they are pure modules, unit tested
 * outside the extension host, and `vscode.l10n` only exists inside it. `message`
 * therefore stays English — it is what ends up in the log and in bug reports —
 * while `code` is what the notification is built from.
 */
export type ClipboardErrorCode = 'noGraphicalSession' | 'clipboardToolMissing';

export interface ClipboardError {
  kind: 'error';
  /** English, for the log; never shown as-is when `code` is set. */
  message: string;
  code?: ClipboardErrorCode;
  /** Tool names named by a `clipboardToolMissing` message. */
  tools?: string[];
  /**
   * Set when the user can fix this themselves — a missing Linux clipboard tool,
   * for instance. Those are worth surfacing once instead of only logging, since
   * the user just pressed a key and nothing happened.
   */
  actionable?: boolean;
  remedy?: InstallPackagesRemedy;
}

export type ClipboardContent = ClipboardFiles | ClipboardImage | ClipboardOther | ClipboardError;

/** Longest reader output quoted back into an error message. */
const MAX_SNIPPET = 200;

/**
 * Parses reader output, never throws.
 *
 * Malformed output becomes `kind: 'error'` rather than an exception: every
 * non-payload outcome ends in the same place (log it, let the native paste
 * through), and an error value carries the diagnostic text along.
 */
export function parseClipboardPayload(raw: string): ClipboardContent {
  const json = extractJsonObject(raw);
  if (json === undefined) {
    return { kind: 'error', message: `reader produced no JSON object: ${snippet(raw)}` };
  }

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      kind: 'error',
      message: `reader output is not valid JSON (${reason}): ${snippet(raw)}`,
    };
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'error', message: `reader output is not a JSON object: ${snippet(raw)}` };
  }

  const record = value as Record<string, unknown>;
  switch (record['kind']) {
    case 'files':
    case 'image': {
      const kind = record['kind'];
      const paths = stringArray(record['paths']);
      if (paths.length === 0) {
        return { kind: 'error', message: `reader returned kind "${kind}" with no usable paths` };
      }
      return kind === 'files' ? { kind: 'files', paths } : { kind: 'image', paths };
    }
    case 'other':
      return { kind: 'other', types: stringArray(record['types']) };
    case 'error':
      return {
        kind: 'error',
        message:
          typeof record['message'] === 'string' ? record['message'] : 'unspecified reader error',
      };
    default:
      return { kind: 'error', message: `reader returned unknown kind: ${snippet(raw)}` };
  }
}

/**
 * Pulls the JSON object out of the reader's stdout.
 *
 * Interpreters are entitled to print their own noise (deprecation notices, for
 * instance), so the payload is located rather than assumed to be the whole
 * stream.
 */
function extractJsonObject(raw: string): string | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  return raw.slice(start, end + 1);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function snippet(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return '(empty output)';
  return collapsed.length <= MAX_SNIPPET ? collapsed : `${collapsed.slice(0, MAX_SNIPPET)}…`;
}
