import {
  describeBundledMetadataOnlyChannelCatalogContract,
  describeOfficialFallbackChannelCatalogContract,
} from "../../test/helpers/channels/channel-catalog-contract.js";

const whatsappMeta = {
  id: "whatsapp",
  label: "WhatsApp",
  selectionLabel: "WhatsApp (QR link)",
  detailLabel: "WhatsApp Web",
  docsPath: "/channels/whatsapp",
  blurb: "works with your own number; recommend a separate phone + eSIM.",
};

describeBundledMetadataOnlyChannelCatalogContract({
  pluginId: "whatsapp",
  packageName: "@alisio/whatsapp",
  npmSpec: "@alisio/whatsapp",
  meta: whatsappMeta,
  defaultChoice: "npm",
});

describeOfficialFallbackChannelCatalogContract({
  channelId: "whatsapp",
  npmSpec: "@alisio/whatsapp",
  meta: whatsappMeta,
  packageName: "@alisio/whatsapp",
  pluginId: "whatsapp",
  externalNpmSpec: "@vendor/whatsapp-fork",
  externalLabel: "WhatsApp Fork",
});
