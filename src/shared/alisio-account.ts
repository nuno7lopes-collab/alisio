export const ALISIO_USERNAME_MIN_LENGTH = 4;
export const ALISIO_USERNAME_MAX_LENGTH = 15;
export const ALISIO_USERNAME_ALLOWED_PATTERN = /^[A-Za-z0-9._]+$/;
export const ALISIO_USERNAME_ALLOWED_PATTERN_SOURCE = "^[A-Za-z0-9._]+$";

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AlisioAccountDraft = {
  username: string;
  displayName: string;
  email: string;
  avatarLabel?: string;
};

export function normalizeAlisioUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validateAlisioUsername(value: string): string | null {
  const normalized = normalizeAlisioUsername(value);
  if (!normalized) {
    return "Choose a username.";
  }
  if (normalized.length < ALISIO_USERNAME_MIN_LENGTH) {
    return `Your username must be at least ${ALISIO_USERNAME_MIN_LENGTH} characters long.`;
  }
  if (normalized.length > ALISIO_USERNAME_MAX_LENGTH) {
    return `Your username cannot be longer than ${ALISIO_USERNAME_MAX_LENGTH} characters.`;
  }
  if (!ALISIO_USERNAME_ALLOWED_PATTERN.test(normalized)) {
    return "Use only letters, numbers, dots, and underscores.";
  }
  return null;
}

export function validateAlisioDisplayName(value: string): string | null {
  if (!value.trim()) {
    return "Add the name Alisio should use for you.";
  }
  return null;
}

export function validateAlisioEmail(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return "Add an email address.";
  }
  if (!SIMPLE_EMAIL_PATTERN.test(normalized)) {
    return "Use a valid email address.";
  }
  return null;
}

export function deriveAlisioAvatarLabel(input: {
  avatarLabel?: string;
  displayName?: string;
  username?: string;
}) {
  const explicit = input.avatarLabel?.trim().slice(0, 2).toUpperCase();
  if (explicit) {
    return explicit;
  }
  const fromName = input.displayName?.trim().slice(0, 1).toUpperCase();
  if (fromName) {
    return fromName;
  }
  const fromUsername = normalizeAlisioUsername(input.username ?? "")
    .slice(0, 1)
    .toUpperCase();
  return fromUsername || "A";
}

export function validateAlisioAccountDraft(draft: AlisioAccountDraft) {
  const username = validateAlisioUsername(draft.username);
  if (username) {
    return username;
  }
  const displayName = validateAlisioDisplayName(draft.displayName);
  if (displayName) {
    return displayName;
  }
  const email = validateAlisioEmail(draft.email);
  if (email) {
    return email;
  }
  return null;
}
