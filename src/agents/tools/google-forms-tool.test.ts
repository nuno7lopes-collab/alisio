import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAlisioGoogleFormMock, readAlisioGoogleFormMock } = vi.hoisted(() => ({
  createAlisioGoogleFormMock: vi.fn(),
  readAlisioGoogleFormMock: vi.fn(),
}));

vi.mock("../../infra/alisio-google-forms.js", () => ({
  createAlisioGoogleForm: createAlisioGoogleFormMock,
  readAlisioGoogleForm: readAlisioGoogleFormMock,
}));

describe("createGoogleFormsTool", () => {
  beforeEach(() => {
    vi.resetModules();
    createAlisioGoogleFormMock.mockReset();
    readAlisioGoogleFormMock.mockReset();
  });

  it("creates forms", async () => {
    const { createGoogleFormsTool } = await import("./google-forms-tool.js");
    createAlisioGoogleFormMock.mockResolvedValue({
      ok: true,
      status: "created",
      connectorId: "google-forms",
      formId: "form-1",
      title: "Leads",
      editUrl: "https://docs.google.com/forms/d/form-1/edit",
      questionCount: 1,
      questions: [],
    });

    const result = await createGoogleFormsTool().execute?.("tool-1", {
      action: "create",
      title: "Leads",
      description: "Intake",
      questions: ["Name"],
    });

    expect(createAlisioGoogleFormMock).toHaveBeenCalledWith({
      title: "Leads",
      description: "Intake",
      questions: ["Name"],
    });
    expect(result?.details).toMatchObject({
      status: "created",
      connectorId: "google-forms",
    });
  });

  it("reads forms", async () => {
    const { createGoogleFormsTool } = await import("./google-forms-tool.js");
    readAlisioGoogleFormMock.mockResolvedValue({
      ok: true,
      status: "read",
      connectorId: "google-forms",
      formId: "form-1",
      title: "Leads",
      editUrl: "https://docs.google.com/forms/d/form-1/edit",
      questionCount: 1,
      questions: [],
    });

    const result = await createGoogleFormsTool().execute?.("tool-1", {
      action: "read",
      formId: "form-1",
    });

    expect(readAlisioGoogleFormMock).toHaveBeenCalledWith({
      formId: "form-1",
    });
    expect(result?.details).toMatchObject({
      status: "read",
      connectorId: "google-forms",
    });
  });
});
