import { afterEach, describe, expect, it } from "vitest";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  attachTaskProposalLaunch,
  getTaskProposalViewById,
  listTaskProposalViews,
  resolveTaskProposalDecision,
  summarizeTaskProposals,
  upsertTaskProposal,
} from "./task-proposals.js";
import { resetTaskRegistryForTests } from "./task-registry.js";
import { createTask } from "./task-service.js";

const ORIGINAL_STATE_DIR = process.env.ALISIO_STATE_DIR;

async function withTaskProposalStateDir(run: () => Promise<void>) {
  await withTempDir({ prefix: "alisio-task-proposals-" }, async (root) => {
    process.env.ALISIO_STATE_DIR = root;
    resetTaskRegistryForTests();
    try {
      await run();
    } finally {
      resetTaskRegistryForTests();
    }
  });
}

describe("task proposals", () => {
  afterEach(() => {
    if (ORIGINAL_STATE_DIR === undefined) {
      delete process.env.ALISIO_STATE_DIR;
    } else {
      process.env.ALISIO_STATE_DIR = ORIGINAL_STATE_DIR;
    }
    resetTaskRegistryForTests();
  });

  it("deduplicates proposals by requester session and client key", async () => {
    await withTaskProposalStateDir(async () => {
      const created = upsertTaskProposal({
        clientKey: "msg:assistant:1:0",
        requesterSessionKey: "agent:main:main",
        title: "Ship task inbox",
        summary: "First draft",
        acceptance: ["Inbox exists"],
      });

      const updated = upsertTaskProposal({
        clientKey: "msg:assistant:1:0",
        requesterSessionKey: "agent:main:main",
        title: "Ship task inbox",
        summary: "Updated draft",
        acceptance: ["Inbox exists", "Chat cards work"],
      });

      expect(updated.proposalId).toBe(created.proposalId);
      expect(updated.summary).toBe("Updated draft");
      expect(updated.acceptance).toEqual(["Inbox exists", "Chat cards work"]);
      expect(listTaskProposalViews()).toHaveLength(1);
    });
  });

  it("summarizes pending, approved, rejected, and launched proposals", async () => {
    await withTaskProposalStateDir(async () => {
      const pending = upsertTaskProposal({
        clientKey: "msg:assistant:pending:0",
        requesterSessionKey: "agent:main:main",
        title: "Pending",
      });
      const approved = resolveTaskProposalDecision({
        proposalId: pending.proposalId,
        decision: "approved",
      });
      const rejected = resolveTaskProposalDecision({
        proposalId: upsertTaskProposal({
          clientKey: "msg:assistant:rejected:0",
          requesterSessionKey: "agent:main:main",
          title: "Rejected",
        }).proposalId,
        decision: "rejected",
      });
      const launched = attachTaskProposalLaunch({
        proposalId: approved.proposalId,
        taskId: "task-proposal-1",
        runId: "run-proposal-1",
        sessionKey: "agent:main:dashboard:1",
      });

      expect(summarizeTaskProposals([launched, rejected])).toEqual({
        total: 2,
        pending: 0,
        approved: 1,
        rejected: 1,
        launched: 1,
      });
    });
  });

  it("links launched proposals back to task records", async () => {
    await withTaskProposalStateDir(async () => {
      const task = createTask({
        title: "Implement the inbox",
        requesterSessionKey: "agent:main:main",
        orchestratorSessionKey: "agent:main:dashboard:1",
      });

      const proposal = upsertTaskProposal({
        clientKey: "msg:assistant:launch:0",
        requesterSessionKey: "agent:main:main",
        title: "Implement inbox",
      });
      const launched = attachTaskProposalLaunch({
        proposalId: proposal.proposalId,
        taskId: task.taskId,
        runId: "run-proposal-1",
        sessionKey: "agent:main:dashboard:1",
      });

      expect(launched.linkedTask).toMatchObject({
        taskId: task.taskId,
        orchestratorSessionKey: "agent:main:dashboard:1",
      });
      expect(getTaskProposalViewById(proposal.proposalId)?.linkedTask?.taskId).toBe(task.taskId);
    });
  });

  it("forbids launching rejected proposals or overwriting an existing launch", async () => {
    await withTaskProposalStateDir(async () => {
      const rejected = resolveTaskProposalDecision({
        proposalId: upsertTaskProposal({
          clientKey: "msg:assistant:reject-launch:0",
          requesterSessionKey: "agent:main:main",
          title: "Rejected before launch",
        }).proposalId,
        decision: "rejected",
      });

      expect(() =>
        attachTaskProposalLaunch({
          proposalId: rejected.proposalId,
          taskId: "task-rejected",
          runId: "run-rejected",
        }),
      ).toThrow(/rejected/i);

      const proposal = upsertTaskProposal({
        clientKey: "msg:assistant:launch-once:0",
        requesterSessionKey: "agent:main:main",
        title: "Launch once",
      });
      attachTaskProposalLaunch({
        proposalId: proposal.proposalId,
        taskId: "task-first",
        runId: "run-first",
        sessionKey: "agent:main:dashboard:first",
      });

      expect(() =>
        attachTaskProposalLaunch({
          proposalId: proposal.proposalId,
          taskId: "task-second",
          runId: "run-second",
          sessionKey: "agent:main:dashboard:second",
        }),
      ).toThrow(/already linked/i);

      expect(() =>
        resolveTaskProposalDecision({
          proposalId: proposal.proposalId,
          decision: "rejected",
        }),
      ).toThrow(/cannot reject/i);
    });
  });

  it("does not mutate launched proposal content on later upserts", async () => {
    await withTaskProposalStateDir(async () => {
      const created = upsertTaskProposal({
        clientKey: "msg:assistant:launched-content:0",
        requesterSessionKey: "agent:main:main",
        title: "Original title",
        summary: "Original summary",
        acceptance: ["Original acceptance"],
        launchPrompt: "Original launch prompt",
        kind: "task",
      });

      const launched = attachTaskProposalLaunch({
        proposalId: created.proposalId,
        taskId: "task-original",
        runId: "run-original",
        sessionKey: "agent:main:dashboard:launched",
      });

      const updated = upsertTaskProposal({
        clientKey: "msg:assistant:launched-content:0",
        requesterSessionKey: "agent:main:main",
        title: "Changed title",
        summary: "Changed summary",
        acceptance: ["Changed acceptance"],
        launchPrompt: "Changed launch prompt",
        kind: "project",
      });

      expect(updated.title).toBe("Original title");
      expect(updated.summary).toBe("Original summary");
      expect(updated.acceptance).toEqual(["Original acceptance"]);
      expect(updated.launchPrompt).toBe("Original launch prompt");
      expect(updated.kind).toBe("task");
      expect(updated.launchedTaskId).toBe("task-original");
      expect(updated.launchedRunId).toBe("run-original");
      expect(updated.updatedAt).toBe(launched.updatedAt);
    });
  });

  it("treats repeated decision and launch writes as idempotent", async () => {
    await withTaskProposalStateDir(async () => {
      const created = upsertTaskProposal({
        clientKey: "msg:assistant:idempotent:0",
        requesterSessionKey: "agent:main:main",
        title: "Idempotent proposal",
      });

      const approved = resolveTaskProposalDecision({
        proposalId: created.proposalId,
        decision: "approved",
      });
      const approvedAgain = resolveTaskProposalDecision({
        proposalId: created.proposalId,
        decision: "approved",
      });

      expect(approvedAgain.updatedAt).toBe(approved.updatedAt);
      expect(approvedAgain.resolvedAt).toBe(approved.resolvedAt);

      const launched = attachTaskProposalLaunch({
        proposalId: created.proposalId,
        taskId: "task-idempotent",
        runId: "run-idempotent",
      });
      const launchedAgain = attachTaskProposalLaunch({
        proposalId: created.proposalId,
        taskId: "task-idempotent",
        runId: "run-idempotent",
      });

      expect(launchedAgain.updatedAt).toBe(launched.updatedAt);
      expect(launchedAgain.launchedAt).toBe(launched.launchedAt);
      expect(launchedAgain.launchedTaskId).toBe("task-idempotent");
      expect(launchedAgain.launchedRunId).toBe("run-idempotent");
    });
  });
});
