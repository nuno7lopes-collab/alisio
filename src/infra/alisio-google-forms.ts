import {
  extractGoogleApiProviderErrorMessage,
  extractGoogleApiProviderReason,
  isGoogleApiReconnectRequired,
  resolveAlisioConnectorRuntimeAccess,
} from "./alisio-connector-runtime.js";

const GOOGLE_FORMS_CONNECTOR_ID = "google-forms";
const GOOGLE_FORMS_API_ROOT = "https://forms.googleapis.com/v1/forms";

export type AlisioGoogleFormQuestion = {
  itemId?: string;
  questionId?: string;
  title: string;
  description?: string;
  type: "text" | "paragraph" | "choice" | "unknown";
  required: boolean;
  options?: string[];
};

export type AlisioGoogleFormsResult =
  | {
      ok: true;
      status: "created";
      connectorId: "google-forms";
      formId: string;
      title: string;
      description?: string;
      editUrl: string;
      responderUrl?: string;
      questionCount: number;
      questions: AlisioGoogleFormQuestion[];
    }
  | {
      ok: true;
      status: "read";
      connectorId: "google-forms";
      formId: string;
      title: string;
      description?: string;
      editUrl: string;
      responderUrl?: string;
      questionCount: number;
      questions: AlisioGoogleFormQuestion[];
    }
  | {
      ok: false;
      status: "auth_required" | "create_failed" | "read_failed";
      connectorId: "google-forms";
      message: string;
      reconnectRequired?: boolean;
      providerReason?: string;
    };

function buildGoogleFormsEditUrl(formId: string): string {
  return `https://docs.google.com/forms/d/${encodeURIComponent(formId)}/edit`;
}

function normalizeGoogleFormId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    const responderMatch = parsed.pathname.match(/\/forms\/d\/e\/([^/]+)/);
    if (responderMatch?.[1]) {
      return responderMatch[1];
    }
    const editMatch = parsed.pathname.match(/\/forms\/d\/([^/]+)/);
    if (editMatch?.[1]) {
      return editMatch[1];
    }
  } catch {
    // Treat plain ids as-is.
  }
  return trimmed;
}

function normalizeGoogleFormQuestion(
  item: Record<string, unknown>,
): AlisioGoogleFormQuestion | null {
  const questionItem =
    typeof item.questionItem === "object" && item.questionItem
      ? (item.questionItem as Record<string, unknown>)
      : null;
  const question =
    questionItem && typeof questionItem.question === "object" && questionItem.question
      ? (questionItem.question as Record<string, unknown>)
      : null;
  if (!question) {
    return null;
  }
  const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : null;
  if (!title) {
    return null;
  }
  let type: AlisioGoogleFormQuestion["type"] = "unknown";
  let options: string[] | undefined;
  if (typeof question.textQuestion === "object" && question.textQuestion) {
    const paragraph =
      typeof (question.textQuestion as { paragraph?: unknown }).paragraph === "boolean"
        ? (question.textQuestion as { paragraph: boolean }).paragraph
        : false;
    type = paragraph ? "paragraph" : "text";
  } else if (typeof question.choiceQuestion === "object" && question.choiceQuestion) {
    type = "choice";
    const rawOptions = (question.choiceQuestion as { options?: unknown }).options;
    options = Array.isArray(rawOptions)
      ? rawOptions.flatMap((entry) => {
          if (!entry || typeof entry !== "object") {
            return [];
          }
          const value = (entry as { value?: unknown }).value;
          return typeof value === "string" && value.trim() ? [value.trim()] : [];
        })
      : undefined;
  }
  const description =
    typeof item.description === "string" && item.description.trim()
      ? item.description.trim()
      : undefined;
  return {
    ...(typeof item.itemId === "string" && item.itemId.trim()
      ? { itemId: item.itemId.trim() }
      : {}),
    ...(typeof question.questionId === "string" && question.questionId.trim()
      ? { questionId: question.questionId.trim() }
      : {}),
    title,
    ...(description ? { description } : {}),
    type,
    required: question.required === true,
    ...(options && options.length > 0 ? { options } : {}),
  };
}

function normalizeGoogleFormQuestions(items: unknown): AlisioGoogleFormQuestion[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const normalized = normalizeGoogleFormQuestion(item as Record<string, unknown>);
    return normalized ? [normalized] : [];
  });
}

function buildFormsAuthError(params: { reconnectRequired: boolean }): AlisioGoogleFormsResult {
  return {
    ok: false,
    status: "auth_required",
    connectorId: GOOGLE_FORMS_CONNECTOR_ID,
    message: params.reconnectRequired
      ? "Google Forms authorization is no longer valid. Reconnect Google Forms in Apps."
      : "Google Forms is not connected in Alisio. Connect Google Forms in Apps first.",
    reconnectRequired: params.reconnectRequired,
  };
}

export async function createAlisioGoogleForm(
  input: {
    title: string;
    description?: string;
    questions?: string[];
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleFormsResult> {
  const title = input.title.trim();
  if (!title) {
    return {
      ok: false,
      status: "create_failed",
      connectorId: GOOGLE_FORMS_CONNECTOR_ID,
      message: "Google Forms title is required.",
    };
  }

  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_FORMS_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildFormsAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const questions = (input.questions ?? []).map((value) => value.trim()).filter(Boolean);

  try {
    const createResponse = await fetchImpl(GOOGLE_FORMS_API_ROOT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${authorization.accessToken}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        info: {
          title,
          ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        },
      }),
    });
    const createBody = (await createResponse.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const createReason = extractGoogleApiProviderReason(createBody);
    if (
      !createResponse.ok ||
      !createBody ||
      typeof createBody.formId !== "string" ||
      !createBody.formId.trim()
    ) {
      const reconnectRequired = isGoogleApiReconnectRequired(createResponse.status, createReason);
      const message =
        createReason === "insufficientPermissions"
          ? "Google Forms needs to be reconnected with Forms access."
          : reconnectRequired
            ? "Google Forms authorization is no longer valid. Reconnect Google Forms in Apps."
            : extractGoogleApiProviderErrorMessage(
                createBody,
                "Google Forms rejected the create request.",
              );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "create_failed",
        connectorId: GOOGLE_FORMS_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(createReason ? { providerReason: createReason } : {}),
      };
    }

    const formId = createBody.formId.trim();
    let finalBody = createBody;
    if (questions.length > 0) {
      const updateResponse = await fetchImpl(
        `${GOOGLE_FORMS_API_ROOT}/${encodeURIComponent(formId)}:batchUpdate`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${authorization.accessToken}`,
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            includeFormInResponse: true,
            requests: questions.map((questionTitle, index) => ({
              createItem: {
                item: {
                  title: questionTitle,
                  questionItem: {
                    question: {
                      required: false,
                      textQuestion: {
                        paragraph: false,
                      },
                    },
                  },
                },
                location: {
                  index,
                },
              },
            })),
          }),
        },
      );
      const updateBody = (await updateResponse.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const updateReason = extractGoogleApiProviderReason(updateBody);
      if (!updateResponse.ok || !updateBody) {
        const reconnectRequired = isGoogleApiReconnectRequired(updateResponse.status, updateReason);
        const message =
          updateReason === "insufficientPermissions"
            ? "Google Forms needs to be reconnected with Forms access."
            : reconnectRequired
              ? "Google Forms authorization is no longer valid. Reconnect Google Forms in Apps."
              : extractGoogleApiProviderErrorMessage(
                  updateBody,
                  "Google Forms created the form but could not add the questions.",
                );
        return {
          ok: false,
          status: reconnectRequired ? "auth_required" : "create_failed",
          connectorId: GOOGLE_FORMS_CONNECTOR_ID,
          message,
          ...(reconnectRequired ? { reconnectRequired: true } : {}),
          ...(updateReason ? { providerReason: updateReason } : {}),
        };
      }
      if (typeof updateBody.form === "object" && updateBody.form) {
        finalBody = updateBody.form as Record<string, unknown>;
      }
    }

    const normalizedQuestions = normalizeGoogleFormQuestions(finalBody.items);
    return {
      ok: true,
      status: "created",
      connectorId: GOOGLE_FORMS_CONNECTOR_ID,
      formId,
      title:
        typeof finalBody.info === "object" &&
        finalBody.info &&
        typeof (finalBody.info as { title?: unknown }).title === "string" &&
        (finalBody.info as { title: string }).title.trim()
          ? (finalBody.info as { title: string }).title.trim()
          : title,
      ...(typeof finalBody.info === "object" &&
      finalBody.info &&
      typeof (finalBody.info as { description?: unknown }).description === "string" &&
      (finalBody.info as { description: string }).description.trim()
        ? { description: (finalBody.info as { description: string }).description.trim() }
        : {}),
      editUrl: buildGoogleFormsEditUrl(formId),
      ...(typeof finalBody.responderUri === "string" && finalBody.responderUri.trim()
        ? { responderUrl: finalBody.responderUri.trim() }
        : {}),
      questionCount: normalizedQuestions.length,
      questions: normalizedQuestions,
    };
  } catch {
    return {
      ok: false,
      status: "create_failed",
      connectorId: GOOGLE_FORMS_CONNECTOR_ID,
      message: "Google Forms could not be reached right now. Try again in a moment.",
    };
  }
}

export async function readAlisioGoogleForm(
  input: {
    formId: string;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGoogleFormsResult> {
  const formId = normalizeGoogleFormId(input.formId);
  if (!formId) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GOOGLE_FORMS_CONNECTOR_ID,
      message: "Google Forms form id is required.",
    };
  }

  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GOOGLE_FORMS_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildFormsAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  try {
    const response = await fetchImpl(`${GOOGLE_FORMS_API_ROOT}/${encodeURIComponent(formId)}`, {
      headers: {
        authorization: `Bearer ${authorization.accessToken}`,
        accept: "application/json",
      },
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const providerReason = extractGoogleApiProviderReason(body);
    if (!response.ok || !body) {
      const reconnectRequired = isGoogleApiReconnectRequired(response.status, providerReason);
      const message =
        providerReason === "insufficientPermissions"
          ? "Google Forms needs to be reconnected with Forms access."
          : reconnectRequired
            ? "Google Forms authorization is no longer valid. Reconnect Google Forms in Apps."
            : extractGoogleApiProviderErrorMessage(body, "Google Forms rejected the read request.");
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: GOOGLE_FORMS_CONNECTOR_ID,
        message,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        ...(providerReason ? { providerReason } : {}),
      };
    }
    const normalizedQuestions = normalizeGoogleFormQuestions(body.items);
    const info =
      typeof body.info === "object" && body.info ? (body.info as Record<string, unknown>) : {};
    return {
      ok: true,
      status: "read",
      connectorId: GOOGLE_FORMS_CONNECTOR_ID,
      formId,
      title:
        typeof info.title === "string" && info.title.trim() ? info.title.trim() : "Untitled form",
      ...(typeof info.description === "string" && info.description.trim()
        ? { description: info.description.trim() }
        : {}),
      editUrl: buildGoogleFormsEditUrl(formId),
      ...(typeof body.responderUri === "string" && body.responderUri.trim()
        ? { responderUrl: body.responderUri.trim() }
        : {}),
      questionCount: normalizedQuestions.length,
      questions: normalizedQuestions,
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GOOGLE_FORMS_CONNECTOR_ID,
      message: "Google Forms could not be reached right now. Try again in a moment.",
    };
  }
}
