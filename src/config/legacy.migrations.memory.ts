import {
  defineLegacyConfigMigration,
  getRecord,
  type LegacyConfigMigrationSpec,
  type LegacyConfigRule,
} from "./legacy.shared.js";

const DEPRECATED_MEMORY_PATH_KEY_MESSAGES = {
  memoryPath: "memory.memoryPath is deprecated and will be auto-removed on load.",
  vaultPath: "memory.vaultPath is deprecated and will be auto-removed on load.",
} as const;

type DeprecatedMemoryPathKey = keyof typeof DEPRECATED_MEMORY_PATH_KEY_MESSAGES;

const DEPRECATED_MEMORY_PATH_KEYS = Object.keys(
  DEPRECATED_MEMORY_PATH_KEY_MESSAGES,
) as DeprecatedMemoryPathKey[];

function hasOwnKey(target: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function hasDeprecatedMemoryPathKey(value: unknown, key: DeprecatedMemoryPathKey): boolean {
  const memory = getRecord(value);
  return Boolean(memory && hasOwnKey(memory, key));
}

const DEPRECATED_MEMORY_PATH_RULES: LegacyConfigRule[] = DEPRECATED_MEMORY_PATH_KEYS.map((key) => ({
  path: ["memory", key],
  message: DEPRECATED_MEMORY_PATH_KEY_MESSAGES[key],
  match: (_, root) => hasDeprecatedMemoryPathKey(root.memory, key),
  requireSourceLiteral: true,
}));

export const LEGACY_CONFIG_MIGRATIONS_MEMORY: LegacyConfigMigrationSpec[] = [
  defineLegacyConfigMigration({
    id: "memory.deprecated-path-keys-cleanup",
    describe: "Remove deprecated memory path config keys during config load",
    legacyRules: DEPRECATED_MEMORY_PATH_RULES,
    apply: (raw, changes) => {
      const memory = getRecord(raw.memory);
      if (!memory) {
        return;
      }

      for (const key of DEPRECATED_MEMORY_PATH_KEYS) {
        if (!hasOwnKey(memory, key)) {
          continue;
        }
        delete memory[key];
        changes.push(`Removed memory.${key}.`);
      }

      if (Object.keys(memory).length === 0) {
        delete raw.memory;
        changes.push("Removed empty memory block after deleting deprecated memory path keys.");
        return;
      }

      raw.memory = memory;
    },
  }),
];
