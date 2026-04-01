import { z } from "zod";

export const PersonAgentProfileSchema = z
  .object({
    name: z.string().optional(),
    timezone: z.string().optional(),
    tone: z.string().optional(),
    writingPreferences: z.array(z.string()).optional(),
    priorities: z.array(z.string()).optional(),
    routines: z.array(z.string()).optional(),
    frequentContacts: z.array(z.string()).optional(),
    frequentContexts: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

export const PersonAgentSchema = z
  .object({
    enabled: z.boolean().optional(),
    scope: z.literal("personal_and_work").optional(),
    autonomyMode: z.literal("draft-first").optional(),
    starterPack: z.literal("browser-first").optional(),
    profile: PersonAgentProfileSchema,
    specialists: z.array(z.string()).optional(),
    memoryScopes: z
      .array(
        z.union([
          z.literal("profile_memory"),
          z.literal("working_memory"),
          z.literal("relationship_memory"),
          z.literal("artifact_memory"),
        ]),
      )
      .optional(),
  })
  .strict()
  .optional();
