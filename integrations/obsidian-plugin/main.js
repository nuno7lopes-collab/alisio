const { Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } = require("obsidian");

const DEFAULT_SETTINGS = {
  memoryPath: "Alisio Memory",
  permissions: {
    list: true,
    read: true,
    write: true,
  },
  writableProfiles: ["default"],
  readonlyProfiles: ["readonly"],
};

function normalizePath(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function splitCsv(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function dirnamePosix(value) {
  const normalized = normalizePath(value);
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function joinPosix(...parts) {
  return parts
    .map((part) => normalizePath(part))
    .filter(Boolean)
    .join("/");
}

function ensureInsideRoot(root, candidate) {
  const normalizedRoot = normalizePath(root);
  const normalizedCandidate = normalizePath(candidate);
  if (!normalizedRoot) {
    throw new Error("memory path is not configured");
  }
  if (!normalizedCandidate) {
    throw new Error("path required");
  }
  const relative = normalizedCandidate.slice(normalizedRoot.length);
  if (normalizedCandidate === normalizedRoot || relative.startsWith("/")) {
    return normalizedCandidate;
  }
  throw new Error("path escapes configured memory directory");
}

function resolveScopedPath(root, value) {
  const normalizedRoot = normalizePath(root);
  const normalizedValue = normalizePath(value);
  if (!normalizedRoot) {
    throw new Error("memory path is not configured");
  }
  if (!normalizedValue) {
    return normalizedRoot;
  }
  const candidate = normalizedValue.startsWith(`${normalizedRoot}/`)
    ? normalizedValue
    : joinPosix(normalizedRoot, normalizedValue);
  if (candidate.includes("/../") || candidate.startsWith("../") || candidate.endsWith("/..")) {
    throw new Error("relative parent segments are not allowed");
  }
  return ensureInsideRoot(normalizedRoot, candidate);
}

function sanitizeSettings(raw) {
  const permissions = raw && typeof raw.permissions === "object" ? raw.permissions : {};
  return {
    memoryPath: normalizePath(raw && raw.memoryPath ? raw.memoryPath : DEFAULT_SETTINGS.memoryPath),
    permissions: {
      list: permissions.list !== false,
      read: permissions.read !== false,
      write: permissions.write !== false,
    },
    writableProfiles: splitCsv(
      Array.isArray(raw && raw.writableProfiles)
        ? raw.writableProfiles.join(",")
        : DEFAULT_SETTINGS.writableProfiles.join(","),
    ),
    readonlyProfiles: splitCsv(
      Array.isArray(raw && raw.readonlyProfiles)
        ? raw.readonlyProfiles.join(",")
        : DEFAULT_SETTINGS.readonlyProfiles.join(","),
    ),
  };
}

class AlisioMemoryBridgePlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.api = {
      status: () => this.getStatus(),
      list: async (params) => await this.listFiles(params),
      read: async (params) => await this.readFile(params),
      write: async (params) => await this.writeFile(params),
    };

    globalThis.alisioObsidianBridge = this.api;

    this.addSettingTab(new AlisioMemoryBridgeSettingTab(this.app, this));
    this.addCommand({
      id: "show-alisio-memory-bridge-status",
      name: "Show Alisio memory bridge status",
      callback: () => {
        const status = this.getStatus();
        new Notice(
          `Alisio bridge ready: ${status.memoryPath} (${status.writableProfiles.length} write profiles)`,
        );
      },
    });
  }

  onunload() {
    if (globalThis.alisioObsidianBridge === this.api) {
      delete globalThis.alisioObsidianBridge;
    }
    delete this.api;
  }

  async loadSettings() {
    this.settings = sanitizeSettings(await this.loadData());
  }

  async saveSettings() {
    this.settings = sanitizeSettings(this.settings);
    await this.saveData(this.settings);
  }

  getStatus() {
    return {
      pluginId: this.manifest.id,
      version: this.manifest.version,
      vaultName: this.app.vault.getName(),
      memoryPath: this.settings.memoryPath,
      permissions: { ...this.settings.permissions },
      writableProfiles: [...this.settings.writableProfiles],
      readonlyProfiles: [...this.settings.readonlyProfiles],
    };
  }

  authorize(operation, profile) {
    const normalizedProfile = String(profile || "default").trim() || "default";
    if (!this.settings.permissions[operation]) {
      throw new Error(`operation "${operation}" is disabled by settings`);
    }
    if (this.settings.writableProfiles.includes(normalizedProfile)) {
      return { profile: normalizedProfile, mode: "write" };
    }
    if (this.settings.readonlyProfiles.includes(normalizedProfile)) {
      if (operation === "write") {
        throw new Error(`profile "${normalizedProfile}" is read-only`);
      }
      return { profile: normalizedProfile, mode: "readonly" };
    }
    throw new Error(`profile "${normalizedProfile}" is not allowed`);
  }

  resolveDirectoryPath(inputPath) {
    return resolveScopedPath(this.settings.memoryPath, inputPath || "");
  }

  resolveMarkdownPath(inputPath) {
    const resolved = resolveScopedPath(this.settings.memoryPath, inputPath);
    if (!resolved.toLowerCase().endsWith(".md")) {
      throw new Error("path must point to a markdown file");
    }
    return resolved;
  }

  async ensureFolder(folderPath) {
    const normalized = normalizePath(folderPath);
    if (!normalized) {
      return;
    }

    const parts = normalized.split("/");
    let cursor = "";
    for (const part of parts) {
      cursor = joinPosix(cursor, part);
      const existing = this.app.vault.getAbstractFileByPath(cursor);
      if (existing instanceof TFolder) {
        continue;
      }
      if (existing) {
        throw new Error(`path "${cursor}" is not a folder`);
      }
      await this.app.vault.createFolder(cursor);
    }
  }

  collectMarkdownFiles(folder, recursive, output) {
    for (const child of folder.children) {
      if (child instanceof TFile && child.path.toLowerCase().endsWith(".md")) {
        output.push(child);
        continue;
      }
      if (recursive && child instanceof TFolder) {
        this.collectMarkdownFiles(child, true, output);
      }
    }
  }

  serializeFile(file) {
    return {
      path: file.path,
      name: file.name,
      basename: file.basename,
      extension: file.extension,
      parent: file.parent ? file.parent.path : "",
      mtime: file.stat.mtime,
      ctime: file.stat.ctime,
      size: file.stat.size,
    };
  }

  async listFiles(params = {}) {
    this.authorize("list", params.profile);

    const directoryPath = this.resolveDirectoryPath(params.path || "");
    const recursive = params.recursive !== false;
    const target = this.app.vault.getAbstractFileByPath(directoryPath);
    if (!target) {
      return [];
    }
    if (target instanceof TFile) {
      if (!target.path.toLowerCase().endsWith(".md")) {
        return [];
      }
      return [this.serializeFile(target)];
    }
    if (!(target instanceof TFolder)) {
      throw new Error("path is not a vault folder");
    }

    const files = [];
    this.collectMarkdownFiles(target, recursive, files);
    return files
      .toSorted((left, right) => right.stat.mtime - left.stat.mtime)
      .map((file) => ({
        ...this.serializeFile(file),
      }));
  }

  async readFile(params = {}) {
    this.authorize("read", params.profile);

    const filePath = this.resolveMarkdownPath(params.path);
    const target = this.app.vault.getAbstractFileByPath(filePath);
    if (!target) {
      return { path: filePath, missing: true, content: "" };
    }
    if (!(target instanceof TFile)) {
      throw new Error("path is not a vault file");
    }

    return {
      ...this.serializeFile(target),
      missing: false,
      content: await this.app.vault.cachedRead(target),
    };
  }

  async writeFile(params = {}) {
    this.authorize("write", params.profile);

    const filePath = this.resolveMarkdownPath(params.path);
    await this.ensureFolder(dirnamePosix(filePath));

    const target = this.app.vault.getAbstractFileByPath(filePath);
    const nextContent = String(params.content || "");
    if (target && !(target instanceof TFile)) {
      throw new Error("path is not a vault file");
    }

    if (target instanceof TFile) {
      const previous = await this.app.vault.cachedRead(target);
      const content = params.append === true ? `${previous}${nextContent}` : nextContent;
      await this.app.vault.modify(target, content);
      return {
        ...this.serializeFile(target),
        content,
      };
    }

    const created = await this.app.vault.create(filePath, nextContent);
    return {
      ...this.serializeFile(created),
      content: nextContent,
    };
  }
}

class AlisioMemoryBridgeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Memory directory")
      .setDesc("Vault-relative directory that the bridge is allowed to access.")
      .addText((text) =>
        text
          .setPlaceholder("Alisio Memory")
          .setValue(this.plugin.settings.memoryPath)
          .onChange(async (value) => {
            this.plugin.settings.memoryPath = normalizePath(value) || DEFAULT_SETTINGS.memoryPath;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Allow list")
      .setDesc("Enable or disable listing markdown files.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.permissions.list).onChange(async (value) => {
          this.plugin.settings.permissions.list = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Allow read")
      .setDesc("Enable or disable reading markdown files.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.permissions.read).onChange(async (value) => {
          this.plugin.settings.permissions.read = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Allow write")
      .setDesc("Enable or disable writing markdown files.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.permissions.write).onChange(async (value) => {
          this.plugin.settings.permissions.write = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Writable profiles")
      .setDesc("Comma-separated bridge profiles allowed to list, read, and write.")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.writableProfiles.join(", ")).onChange(async (value) => {
          this.plugin.settings.writableProfiles = splitCsv(value);
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Read-only profiles")
      .setDesc("Comma-separated bridge profiles allowed to list and read but not write.")
      .addTextArea((text) =>
        text.setValue(this.plugin.settings.readonlyProfiles.join(", ")).onChange(async (value) => {
          this.plugin.settings.readonlyProfiles = splitCsv(value);
          await this.plugin.saveSettings();
        }),
      );
  }
}

module.exports = AlisioMemoryBridgePlugin;
