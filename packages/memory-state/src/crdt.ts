import { createHash } from "node:crypto";
import * as Y from "yjs";
import { MEMORY_STATE_TEXT_FRAGMENT, type BinaryInput } from "./types.js";

function toUint8Array(value: BinaryInput): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (typeof value === "string") {
    return Uint8Array.from(Buffer.from(value, "base64"));
  }
  return new Uint8Array();
}

function createDocFromState(state?: BinaryInput): Y.Doc {
  const doc = new Y.Doc();
  const update = toUint8Array(state);
  if (update.byteLength > 0) {
    Y.applyUpdate(doc, update);
  }
  return doc;
}

export function encodeBinaryBase64(value: BinaryInput): string {
  return Buffer.from(toUint8Array(value)).toString("base64");
}

export function decodeBinaryBase64(value: string | undefined | null): Uint8Array {
  if (!value?.trim()) {
    return new Uint8Array();
  }
  return Uint8Array.from(Buffer.from(value, "base64"));
}

export function readMarkdownFromDocState(state?: BinaryInput): string {
  const doc = createDocFromState(state);
  return doc.getText(MEMORY_STATE_TEXT_FRAGMENT).toJSON();
}

export function createDocStateFromMarkdown(markdown: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText(MEMORY_STATE_TEXT_FRAGMENT).insert(0, markdown);
  return Y.encodeStateAsUpdate(doc);
}

export function createDocUpdateForMarkdown(params: {
  currentState?: BinaryInput;
  markdown: string;
}): Uint8Array {
  const currentDoc = createDocFromState(params.currentState);
  const nextDoc = createDocFromState(params.currentState);
  const text = nextDoc.getText(MEMORY_STATE_TEXT_FRAGMENT);
  const currentText = text.toJSON();
  if (currentText.length > 0) {
    text.delete(0, currentText.length);
  }
  if (params.markdown) {
    text.insert(0, params.markdown);
  }
  return Y.encodeStateAsUpdate(nextDoc, Y.encodeStateVector(currentDoc));
}

export function applyDocUpdateToState(params: {
  currentState?: BinaryInput;
  update: BinaryInput;
}): { yjsState: Uint8Array; markdown: string } {
  const doc = createDocFromState(params.currentState);
  const update = toUint8Array(params.update);
  if (update.byteLength > 0) {
    Y.applyUpdate(doc, update);
  }
  return {
    yjsState: Y.encodeStateAsUpdate(doc),
    markdown: doc.getText(MEMORY_STATE_TEXT_FRAGMENT).toJSON(),
  };
}

export function hashMemoryStateText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
