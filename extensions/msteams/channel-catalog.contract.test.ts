import { describeChannelCatalogEntryContract } from "../../test/helpers/channels/channel-catalog-contract.js";

describeChannelCatalogEntryContract({
  channelId: "msteams",
  npmSpec: "@alisio/msteams",
  alias: "teams",
});
