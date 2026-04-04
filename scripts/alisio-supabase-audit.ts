type AuditOutcome = {
  ok: boolean;
  checks: Record<string, boolean>;
  details: Record<string, unknown>;
};

const supabaseUrl = process.env.ALISIO_SUPABASE_URL?.trim() || "";
const anonKey = process.env.ALISIO_SUPABASE_ANON_KEY?.trim() || "";
const serviceRoleKey = process.env.ALISIO_SUPABASE_SERVICE_ROLE_KEY?.trim() || "";

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  console.error(
    "Missing ALISIO_SUPABASE_URL, ALISIO_SUPABASE_ANON_KEY, or ALISIO_SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const stamp = Date.now();
const password = "AuditPass!23456";

function apiHeaders(apikey: string, bearer: string, extra: Record<string, string> = {}) {
  return {
    apikey,
    Authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
    ...extra,
  };
}

async function parseJson(response: Response) {
  const text = await response.text();
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return { raw: text };
  }
}

async function signUp(email: string) {
  const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: apiHeaders(anonKey, anonKey),
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, body: await parseJson(response) };
}

async function selectProfiles(params: { bearer: string; query: string; apikey?: string }) {
  const response = await fetch(`${supabaseUrl}/rest/v1/alisio_profiles?${params.query}`, {
    headers: apiHeaders(params.apikey ?? anonKey, params.bearer),
  });
  return { status: response.status, body: await parseJson(response) };
}

async function insertProfile(bearer: string, body: Record<string, unknown>) {
  const response = await fetch(`${supabaseUrl}/rest/v1/alisio_profiles`, {
    method: "POST",
    headers: apiHeaders(anonKey, bearer, {
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await parseJson(response) };
}

async function patchProfile(params: {
  apikey: string;
  bearer: string;
  userId: string;
  body: Record<string, unknown>;
}) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/alisio_profiles?user_id=eq.${encodeURIComponent(params.userId)}`,
    {
      method: "PATCH",
      headers: apiHeaders(params.apikey, params.bearer, { Prefer: "return=representation" }),
      body: JSON.stringify(params.body),
    },
  );
  return { status: response.status, body: await parseJson(response) };
}

async function deleteUser(userId: string) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: apiHeaders(serviceRoleKey, serviceRoleKey),
  });
  return { status: response.status, body: await parseJson(response) };
}

async function main() {
  const createdUsers: string[] = [];
  try {
    const emailA = `alisio-audit-${stamp}-a@example.com`;
    const emailB = `alisio-audit-${stamp}-b@example.com`;

    const signUpA = await signUp(emailA);
    const signUpB = await signUp(emailB);

    const userA = (
      signUpA.body as { user?: { id?: string; email?: string }; access_token?: string }
    )?.user;
    const userB = (
      signUpB.body as { user?: { id?: string; email?: string }; access_token?: string }
    )?.user;
    const tokenA = (signUpA.body as { access_token?: string })?.access_token;
    const tokenB = (signUpB.body as { access_token?: string })?.access_token;

    if (!userA?.id || !userB?.id || !userA.email || !userB.email || !tokenA || !tokenB) {
      throw new Error(`Sign-up failed: ${JSON.stringify({ signUpA, signUpB })}`);
    }

    createdUsers.push(userA.id, userB.id);

    const sharedUsername = `audit${String(stamp).slice(-10)}`;

    const insertA = await insertProfile(tokenA, {
      user_id: userA.id,
      email: userA.email,
      display_name: "Audit A",
      username: sharedUsername,
      avatar_label: "AA",
      plan: "free",
      profile_completed: true,
    });
    const insertB = await insertProfile(tokenB, {
      user_id: userB.id,
      email: userB.email,
      display_name: "Audit B",
      username: sharedUsername,
      avatar_label: "AB",
      plan: "free",
      profile_completed: true,
    });

    const ownRead = await selectProfiles({
      bearer: tokenA,
      query: `select=user_id,email,username,plan,profile_completed&user_id=eq.${userA.id}`,
    });
    const crossRead = await selectProfiles({
      bearer: tokenA,
      query: `select=user_id,email,username,plan,profile_completed&user_id=eq.${userB.id}`,
    });
    const anonRead = await selectProfiles({
      bearer: anonKey,
      apikey: anonKey,
      query: `select=user_id,email,username,plan,profile_completed&user_id=eq.${userA.id}`,
    });
    const crossPatch = await patchProfile({
      apikey: anonKey,
      bearer: tokenA,
      userId: userB.id,
      body: { display_name: "HACKED" },
    });
    const driftEmail = await patchProfile({
      apikey: anonKey,
      bearer: tokenA,
      userId: userA.id,
      body: { email: "drifted@example.com" },
    });
    const selfPlanEscalation = await patchProfile({
      apikey: anonKey,
      bearer: tokenA,
      userId: userA.id,
      body: { plan: "plus" },
    });
    const servicePlanUpgrade = await patchProfile({
      apikey: serviceRoleKey,
      bearer: serviceRoleKey,
      userId: userA.id,
      body: { plan: "plus" },
    });
    const finalRead = await selectProfiles({
      bearer: serviceRoleKey,
      apikey: serviceRoleKey,
      query: `select=user_id,email,username,plan,profile_completed&user_id=eq.${userA.id}`,
    });

    const finalRow = Array.isArray(finalRead.body)
      ? (finalRead.body[0] as Record<string, unknown> | undefined)
      : undefined;
    const driftRow = Array.isArray(driftEmail.body)
      ? (driftEmail.body[0] as Record<string, unknown> | undefined)
      : undefined;
    const planRow = Array.isArray(selfPlanEscalation.body)
      ? (selfPlanEscalation.body[0] as Record<string, unknown> | undefined)
      : undefined;

    const checks = {
      signupReturnsSession: signUpA.status === 200 && signUpB.status === 200,
      ownReadWorks:
        ownRead.status === 200 && Array.isArray(ownRead.body) && ownRead.body.length === 1,
      anonReadBlocked:
        (anonRead.status === 200 && Array.isArray(anonRead.body) && anonRead.body.length === 0) ||
        anonRead.status === 401 ||
        anonRead.status === 403,
      crossReadBlocked:
        crossRead.status === 200 && Array.isArray(crossRead.body) && crossRead.body.length === 0,
      crossPatchBlocked:
        crossPatch.status === 200 && Array.isArray(crossPatch.body) && crossPatch.body.length === 0,
      duplicateUsernameBlocked: insertA.status === 201 && insertB.status === 409,
      selfEmailDriftBlocked: driftRow?.email === userA.email,
      selfPlanEscalationBlocked: planRow?.plan !== "plus",
      servicePlanUpgradeWorks: finalRow?.plan === "plus",
    };

    const outcome: AuditOutcome = {
      ok: Object.values(checks).every(Boolean),
      checks,
      details: {
        insertA,
        insertB,
        ownRead,
        crossRead,
        anonRead,
        crossPatch,
        driftEmail,
        selfPlanEscalation,
        servicePlanUpgrade,
        finalRead,
      },
    };

    console.log(JSON.stringify(outcome, null, 2));
    process.exit(outcome.ok ? 0 : 1);
  } finally {
    for (const userId of createdUsers) {
      const cleanup = await deleteUser(userId).catch((error) => ({ error: String(error) }));
      console.error(`cleanup ${userId}: ${JSON.stringify(cleanup)}`);
    }
  }
}

void main();
