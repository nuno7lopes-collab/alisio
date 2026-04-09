import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { ConfigUiHints } from "../types.ts";
import { analyzeConfigSchema } from "./config-form.analyze.ts";
import { renderConfigForm } from "./config-form.render.ts";
import type { JsonSchema } from "./config-form.shared.ts";

type MemorySettingsProps = {
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  schema: unknown;
  uiHints: ConfigUiHints;
  value: Record<string, unknown> | null;
  selectedAgentId: string | null;
  selectedAgentLabel: string | null;
  onPatch: (path: Array<string | number>, value: unknown) => void;
  onSave: () => void;
};

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asSchemaNode(value: unknown): JsonSchema | null {
  const record = asObjectRecord(value);
  return record ? (record as JsonSchema) : null;
}

function readNestedRecord(
  source: Record<string, unknown> | null | undefined,
  path: string[],
): Record<string, unknown> | null {
  let current: unknown = source ?? null;
  for (const segment of path) {
    const record = asObjectRecord(current);
    if (!record) {
      return null;
    }
    current = record[segment];
  }
  return asObjectRecord(current);
}

function readObjectProperty(schema: JsonSchema | null, key: string): JsonSchema | null {
  const properties = asObjectRecord(schema?.properties);
  return asSchemaNode(properties?.[key]);
}

function readArrayItemSchema(schema: JsonSchema | null): JsonSchema | null {
  const items = schema?.items;
  return asSchemaNode(Array.isArray(items) ? items[0] : items);
}

function readAgentMemorySearchRecord(
  source: Record<string, unknown> | null | undefined,
  agentId: string | null,
): Record<string, unknown> | null {
  if (!agentId) {
    return null;
  }
  const list = readNestedRecord(source, ["agents"])?.list;
  if (!Array.isArray(list)) {
    return null;
  }
  for (const entry of list) {
    const record = asObjectRecord(entry);
    if (typeof record?.id === "string" && record.id === agentId) {
      return readNestedRecord(record, ["memorySearch"]);
    }
  }
  return null;
}

function copyPrefixedUiHints(params: {
  uiHints: ConfigUiHints;
  fromPrefix: string;
  toPrefix: string;
  fallbackOrder: number;
}): ConfigUiHints {
  const result: ConfigUiHints = {};
  for (const [path, hint] of Object.entries(params.uiHints)) {
    if (path === params.fromPrefix || path.startsWith(`${params.fromPrefix}.`)) {
      const suffix = path.slice(params.fromPrefix.length);
      const nextPath = `${params.toPrefix}${suffix}`;
      result[nextPath] = {
        ...hint,
        order: hint.order ?? params.fallbackOrder,
      };
    }
  }
  return result;
}

function buildMemorySettingsModel(
  props: Pick<
    MemorySettingsProps,
    "schema" | "uiHints" | "value" | "selectedAgentId" | "selectedAgentLabel"
  >,
) {
  const root = asSchemaNode(props.schema);
  const memorySchema = readObjectProperty(root, "memory");
  const agentsSchema = readObjectProperty(root, "agents");
  const defaultsSchema = readObjectProperty(
    readObjectProperty(agentsSchema, "defaults"),
    "memorySearch",
  );
  const agentListSchema = readObjectProperty(agentsSchema, "list");
  const entrySchema = readObjectProperty(readArrayItemSchema(agentListSchema), "memorySearch");

  const properties: Record<string, JsonSchema> = {};
  const uiHints: ConfigUiHints = {
    memory: {
      label: t("alisio.memory.settings.backendTitle"),
      order: 10,
    },
    defaults: {
      label: t("alisio.memory.settings.defaultsTitle"),
      order: 20,
    },
  };

  if (memorySchema) {
    properties.memory = {
      ...memorySchema,
      title: t("alisio.memory.settings.backendTitle"),
    };
    Object.assign(
      uiHints,
      copyPrefixedUiHints({
        uiHints: props.uiHints,
        fromPrefix: "memory",
        toPrefix: "memory",
        fallbackOrder: 10,
      }),
    );
  }

  if (defaultsSchema) {
    properties.defaults = {
      ...defaultsSchema,
      title: t("alisio.memory.settings.defaultsTitle"),
    };
    Object.assign(
      uiHints,
      copyPrefixedUiHints({
        uiHints: props.uiHints,
        fromPrefix: "agents.defaults.memorySearch",
        toPrefix: "defaults",
        fallbackOrder: 20,
      }),
    );
  }

  if (props.selectedAgentId && entrySchema) {
    properties.agent = {
      ...entrySchema,
      title: t("alisio.memory.settings.agentTitle"),
    };
    uiHints.agent = {
      label: t("alisio.memory.settings.agentTitle"),
      order: 30,
    };
    Object.assign(
      uiHints,
      copyPrefixedUiHints({
        uiHints: props.uiHints,
        fromPrefix: "agents.defaults.memorySearch",
        toPrefix: "agent",
        fallbackOrder: 30,
      }),
    );
    Object.assign(
      uiHints,
      copyPrefixedUiHints({
        uiHints: props.uiHints,
        fromPrefix: "agents.list[].memorySearch",
        toPrefix: "agent",
        fallbackOrder: 30,
      }),
    );
  }

  const value = {
    ...(properties.memory
      ? {
          memory: readNestedRecord(props.value, ["memory"]) ?? {},
        }
      : {}),
    ...(properties.defaults
      ? {
          defaults: readNestedRecord(props.value, ["agents", "defaults", "memorySearch"]) ?? {},
        }
      : {}),
    ...(properties.agent && props.selectedAgentId
      ? {
          agent: readAgentMemorySearchRecord(props.value, props.selectedAgentId) ?? {},
        }
      : {}),
  };

  const analysis =
    Object.keys(properties).length > 0
      ? analyzeConfigSchema({
          type: "object",
          properties,
          additionalProperties: false,
        } satisfies JsonSchema)
      : { schema: null, unsupportedPaths: [] };

  return {
    schema: analysis.schema,
    value,
    uiHints,
    unsupportedPaths: analysis.unsupportedPaths,
  };
}

function mapMemorySettingsPath(
  selectedAgentId: string | null,
  path: Array<string | number>,
): Array<string | number> | null {
  const [section, ...rest] = path;
  if (section === "memory") {
    return ["memory", ...rest];
  }
  if (section === "defaults") {
    return ["agents", "defaults", "memorySearch", ...rest];
  }
  if (section === "agent" && selectedAgentId) {
    return ["agent", ...rest];
  }
  return null;
}

export function renderMemorySettings(props: MemorySettingsProps) {
  const model = buildMemorySettingsModel(props);
  const title = t("alisio.memory.settings.title");
  const unavailable = t("alisio.memory.settings.unavailable");
  const save = t("alisio.memory.settings.save");
  const saving = t("alisio.memory.settings.saving");
  const unsaved = t("alisio.memory.settings.unsaved");

  return html`
    <section class="alisio-memory-settings">
      <div class="alisio-memory-settings__header">
        <div class="alisio-memory-settings__copy"><h3>${title}</h3></div>
        <div class="alisio-memory-settings__actions">
          ${props.dirty ? html`<span class="alisio-memory-badge">${unsaved}</span>` : nothing}
          <button
            class="btn btn--sm primary"
            ?disabled=${props.loading || props.saving || !props.dirty}
            @click=${props.onSave}
          >
            ${props.saving ? saving : save}
          </button>
        </div>
      </div>

      ${props.loading
        ? html`<div class="alisio-memory-settings__empty">${t("alisio.memory.loading")}</div>`
        : !model.schema
          ? html`<div class="alisio-memory-settings__empty">${unavailable}</div>`
          : renderConfigForm({
              schema: model.schema,
              uiHints: model.uiHints,
              value: model.value,
              unsupportedPaths: model.unsupportedPaths,
              onPatch: (path, value) => {
                const mappedPath = mapMemorySettingsPath(props.selectedAgentId, path);
                if (mappedPath) {
                  props.onPatch(mappedPath, value);
                }
              },
            })}
    </section>
  `;
}
