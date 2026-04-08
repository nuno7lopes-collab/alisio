import type { AlisioConfig } from "../../config/types.js";

export type DirectoryConfigParams = {
  cfg: AlisioConfig;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
};
