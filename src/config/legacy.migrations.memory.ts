import {
  defineLegacyConfigMigration,
  getRecord,
  type LegacyConfigMigrationSpec,
  type LegacyConfigRule,
} from "./legacy.shared.js";

const LEGACY_MEMORY_KEY_MESSAGES = {
  memoryPath:
    "memory.memoryPath was removed with the native memory repo cleanup; Alisio now manages native memory paths internally (auto-removed on load).",
  vaultPath:
    "memory.vaultPath was removed with the native memory repo cleanup; Obsidian vault routing is no longer supported (auto-removed on load).",
  obsidianReadOnly:
    "memory.obsidianReadOnly was removed with the native memory repo cleanup; the read-only Obsidian mirror no longer exists (auto-removed on load).",
} as const;

type LegacyMemoryKey = keyof typeof LEGACY_MEMORY_KEY_MESSAGES;

const LEGACY_MEMORY_KEYS = Object.keys(LEGACY_MEMORY_KEY_MESSAGES) as LegacyMemoryKey[];

function hasOwnKey(target: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function hasLegacyMemoryKey(value: unknown, key: LegacyMemoryKey): boolean {
  const memory = getRecord(value);
  return Boolean(memory && hasOwnKey(memory, key));
}

const LEGACY_MEMORY_RULES: LegacyConfigRule[] = LEGACY_MEMORY_KEYS.map((key) => ({
  path: ["memory", key],
  message: LEGACY_MEMORY_KEY_MESSAGES[key],
  match: (_, root) => hasLegacyMemoryKey(root.memory, key),
  requireSourceLiteral: true,
}));

export const LEGACY_CONFIG_MIGRATIONS_MEMORY: LegacyConfigMigrationSpec[] = [
  defineLegacyConfigMigration({
    id: "memory.obsidian-legacy-keys-remove",
    describe: "Remove obsolete Obsidian-era memory config keys during config load",
    legacyRules: LEGACY_MEMORY_RULES,
    apply: (raw, changes) => {
      const memory = getRecord(raw.memory);
      if (!memory) {
        return;
      }

      for (const key of LEGACY_MEMORY_KEYS) {
        if (!hasOwnKey(memory, key)) {
          continue;
        }
        delete memory[key];
        changes.push(`Removed memory.${key}.`);
      }

      if (Object.keys(memory).length === 0) {
        delete raw.memory;
        changes.push("Removed empty memory block after deleting obsolete Obsidian-era keys.");
        return;
      }

      raw.memory = memory;
    },
  }),
];
