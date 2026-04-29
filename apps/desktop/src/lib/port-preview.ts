import {
  PORT_PREVIEW_FRAMEWORKS,
  type PortPreviewMetadata,
} from "@kickstart/contracts";

const DEFAULT_PREVIEW_TIMEOUT_MS = 8_000;
const DEFAULT_PREVIEW_MAX_BYTES = 96 * 1024;

export function extractPortPreviewMetadata(
  html: string,
  url: string,
  responseHeaders?: Headers,
): PortPreviewMetadata | null {
  const title =
    readMetaContent(html, "property", "og:title") ??
    readMetaContent(html, "name", "twitter:title") ??
    readTitle(html);
  const description =
    readMetaContent(html, "property", "og:description") ??
    readMetaContent(html, "name", "description") ??
    readMetaContent(html, "name", "twitter:description");
  const siteName = readMetaContent(html, "property", "og:site_name");

  if (!title && !description && !siteName) {
    return null;
  }

  return {
    description: description ? normalizeWhitespace(decodeHtmlEntities(description)) : null,
    frameworkId: detectFrameworkId(html, responseHeaders),
    siteName: siteName ? normalizeWhitespace(decodeHtmlEntities(siteName)) : null,
    title: title ? normalizeWhitespace(decodeHtmlEntities(title)) : null,
    url,
  };
}

export async function fetchPortPreviewMetadata(
  url: string,
  options?: {
    fetchFn?: typeof fetch;
    maxBytes?: number;
    timeoutMs?: number;
  },
): Promise<PortPreviewMetadata | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const fetchFn = options?.fetchFn ?? fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_PREVIEW_TIMEOUT_MS;
  const maxBytes = options?.maxBytes ?? DEFAULT_PREVIEW_MAX_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Kickstart Desktop",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok || !isLikelyHtml(response)) {
      return null;
    }

    return extractPortPreviewMetadata(await readResponsePrefix(response, maxBytes), url, response.headers);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isLikelyHtml(response: Response) {
  const contentType = response.headers.get("content-type");
  return !contentType || contentType.toLowerCase().includes("html");
}

async function readResponsePrefix(response: Response, maxBytes: number) {
  if (!response.body) {
    return response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (bytesRead < maxBytes) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = value.slice(0, Math.max(maxBytes - bytesRead, 0));
    bytesRead += chunk.byteLength;
    text += decoder.decode(chunk, { stream: bytesRead < maxBytes });
    if (chunk.byteLength < value.byteLength) {
      break;
    }
  }

  await reader.cancel().catch(() => undefined);
  return text + decoder.decode();
}

function readTitle(html: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ?? null;
}

function readMetaContent(html: string, keyAttribute: "name" | "property", keyValue: string) {
  const metaRegex = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaRegex.exec(html))) {
    const tag = match[0] ?? "";
    const key = readAttribute(tag, keyAttribute);
    if (key?.toLowerCase() !== keyValue.toLowerCase()) {
      continue;
    }
    const content = readAttribute(tag, "content");
    if (content) {
      return content;
    }
  }
  return null;
}

function readAttribute(tag: string, attribute: string) {
  const regex = new RegExp(`${attribute}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`, "i");
  const match = tag.match(regex);
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? null;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function detectFrameworkId(html: string, headers?: Headers) {
  const poweredBy = headers?.get("x-powered-by")?.toLowerCase() ?? "";
  const lowerHtml = html.toLowerCase();

  for (const framework of PORT_PREVIEW_FRAMEWORKS) {
    if (
      framework.headerKeywords.some((keyword) => poweredBy.includes(keyword)) ||
      framework.htmlMarkers.some((marker) => lowerHtml.includes(marker))
    ) {
      return framework.id;
    }
  }

  return null;
}
