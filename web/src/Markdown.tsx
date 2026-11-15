import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import { isSafeHttpUrl } from "./safeUrl";

/** Tags the details text may use. No `img`: an image would make a third-party request. No raw HTML plugin. */
const ALLOWED_ELEMENTS = ["p", "strong", "em", "code", "pre", "ul", "ol", "li", "a", "h3", "h4", "blockquote"];

function safeUrl(url: string): string {
  return isSafeHttpUrl(url) ? url : "";
}

/** A link with an http(s) target opens in a new tab; any other target is shown as plain text. */
function ExternalLink({ href, children }: ComponentProps<"a">) {
  if (!isSafeHttpUrl(href)) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/** The item's details_md as React elements: raw HTML is shown as text, only http(s) links survive. */
export function Markdown({ source }: { source: string }) {
  return (
    <ReactMarkdown
      allowedElements={ALLOWED_ELEMENTS}
      unwrapDisallowed
      urlTransform={safeUrl}
      components={{ a: ExternalLink }}
    >
      {source}
    </ReactMarkdown>
  );
}
