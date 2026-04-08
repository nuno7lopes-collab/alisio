import {
  describeImageWithModel,
  describeImagesWithModel,
  type MediaUnderstandingProvider,
} from "alisio/plugin-sdk/media-understanding";

export const zaiMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "zai",
  capabilities: ["image"],
  describeImage: describeImageWithModel,
  describeImages: describeImagesWithModel,
};
