declare module "jsdom" {
  export type DOMWindow = Window &
    typeof globalThis & {
      fetch: typeof fetch;
    };

  export interface JSDOMOptions {
    pretendToBeVisual?: boolean;
    runScripts?: "dangerously" | "outside-only";
    url?: string;
    beforeParse?: (window: DOMWindow) => void;
  }

  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    window: DOMWindow;
  }
}
