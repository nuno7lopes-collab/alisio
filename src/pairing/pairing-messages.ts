import { formatCliCommand } from "../cli/command-format.js";
import type { PairingChannel } from "./pairing-store.js";

export function buildPairingReply(params: {
  channel: PairingChannel;
  idLine: string;
  code: string;
}): string {
  const { channel, idLine, code } = params;
  const approveCommand = formatCliCommand(`openclaw pairing approve ${channel} ${code}`);
  return [
    "OpenClaw: this account is not approved yet.",
    "",
    idLine,
    "",
    "A bot owner needs to approve this access request before the conversation can start.",
    "",
    "Pairing code:",
    "```",
    code,
    "```",
    "",
    "If you are the owner, approve it with:",
    "```",
    approveCommand,
    "```",
  ].join("\n");
}
