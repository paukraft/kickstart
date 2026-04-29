import { describe, expect, it } from "vitest";

import { extractPortPreviewMetadata } from "./port-preview";

describe("extractPortPreviewMetadata", () => {
  it("prefers Open Graph title and description", () => {
    expect(
      extractPortPreviewMetadata(
        `
          <html>
            <head>
              <title>Fallback title</title>
              <meta property="og:title" content="Dashboard &amp; API">
              <meta property="og:description" content="Local dev preview">
              <meta property="og:site_name" content="Kickstart">
            </head>
          </html>
        `,
        "http://localhost:3000",
      ),
    ).toEqual({
      description: "Local dev preview",
      frameworkId: null,
      siteName: "Kickstart",
      title: "Dashboard & API",
      url: "http://localhost:3000",
    });
  });

  it("falls back to document title and standard description", () => {
    expect(
      extractPortPreviewMetadata(
        `
          <html>
            <head>
              <meta name="description" content="  A tiny app.  ">
              <title>
                App Home
              </title>
            </head>
          </html>
        `,
        "http://localhost:5173",
      ),
    ).toEqual({
      description: "A tiny app.",
      frameworkId: null,
      siteName: null,
      title: "App Home",
      url: "http://localhost:5173",
    });
  });

  it("returns null when no preview metadata exists", () => {
    expect(extractPortPreviewMetadata("<html><body>Hello</body></html>", "http://localhost:8080")).toBeNull();
  });

  it("detects framework markers from local dev HTML", () => {
    expect(
      extractPortPreviewMetadata(
        `
          <html>
            <head><title>Acme App</title></head>
            <body><script id="__NEXT_DATA__" type="application/json">{}</script></body>
          </html>
        `,
        "http://localhost:3000",
      )?.frameworkId,
    ).toBe("next");

    expect(
      extractPortPreviewMetadata(
        `
          <html>
            <head><title>Acme App</title><script type="module" src="/@vite/client"></script></head>
          </html>
        `,
        "http://localhost:5173",
      )?.frameworkId,
    ).toBe("vite");
  });
});
