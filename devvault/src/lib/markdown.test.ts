import { describe, it, expect } from "vitest";
import { renderMarkdown, highlightHtml } from "./markdown";

// ---------------------------------------------------------------------------
// renderMarkdown — whitespace preservation
// ---------------------------------------------------------------------------


describe("renderMarkdown — whitespace preservation", () => {
  it("plain line gets pre-wrap style", () => {
    const result = renderMarkdown("hello   world");
    expect(result).toContain('style="white-space:pre-wrap"');
  });

  it("heading does NOT get pre-wrap", () => {
    const result = renderMarkdown("# Heading");
    expect(result).not.toContain("pre-wrap");
  });

  it("list item does NOT get pre-wrap", () => {
    const result = renderMarkdown("- item");
    expect(result).toContain("<li>");
    expect(result).not.toContain("pre-wrap");
  });

  it("code fence does NOT get pre-wrap", () => {
    const result = renderMarkdown("```\ncode\n```");
    expect(result).toContain("<pre");
    expect(result).not.toContain("pre-wrap");
  });
});

// ---------------------------------------------------------------------------
// renderMarkdown — link rendering
// ---------------------------------------------------------------------------

describe("renderMarkdown — link rendering", () => {
  it("link renders with data-url, no href", () => {
    const result = renderMarkdown("[text](https://ex.com)");
    expect(result).toContain('data-url="https://ex.com"');
    expect(result).not.toContain("href=");
  });

  it("link display text is correct", () => {
    const result = renderMarkdown("[click here](https://ex.com)");
    expect(result).toContain(">click here<");
  });

  it("link URL is HTML-escaped", () => {
    const result = renderMarkdown("[t](<script>alert(1)</script>)");
    expect(result).not.toContain("<script>");
  });
});

// ---------------------------------------------------------------------------
// highlightHtml
// ---------------------------------------------------------------------------

describe("highlightHtml", () => {
  it("wraps text match in mark", () => {
    const result = highlightHtml("<p>hello world</p>", "hello");
    expect(result).toContain("<mark");
    expect(result).toContain(">hello</mark>");
  });

  it("skips tag attribute content", () => {
    // "hello" is in the attribute only — text node is "link", no match
    const result = highlightHtml('<a data-url="hello">link</a>', "hello");
    expect(result).toContain('data-url="hello"');
    expect(result).not.toContain("<mark");
  });

  it("case-insensitive matching", () => {
    const result = highlightHtml("<p>Hello World</p>", "hello");
    expect(result).toContain("<mark");
    expect(result).toContain(">Hello</mark>");
  });

  it("multiple occurrences all wrapped", () => {
    const result = highlightHtml("<p>foo bar foo</p>", "foo");
    const count = (result.match(/<mark/g) ?? []).length;
    expect(count).toBe(2);
  });

  it("empty query returns unchanged html", () => {
    const html = "<p>hello world</p>";
    const result = highlightHtml(html, "");
    expect(result).not.toContain("<mark");
    expect(result).toBe(html);
  });

  it("handles regex special chars in query (C++)", () => {
    expect(() => highlightHtml("<p>C++ code</p>", "C++")).not.toThrow();
    const result = highlightHtml("<p>C++ code</p>", "C++");
    expect(result).toContain("<mark");
  });

  it("handles bracket chars in query", () => {
    expect(() => highlightHtml("<p>[note]</p>", "[note]")).not.toThrow();
    const result = highlightHtml("<p>[note]</p>", "[note]");
    expect(result).toContain("<mark");
  });
});

// ---------------------------------------------------------------------------
// Regression guards — existing markdown behaviour must not change
// ---------------------------------------------------------------------------

describe("renderMarkdown — regression guards", () => {
  it("bold still renders", () => {
    expect(renderMarkdown("**bold**")).toContain("<strong>bold</strong>");
  });

  it("italic still renders", () => {
    expect(renderMarkdown("*italic*")).toContain("<em>italic</em>");
  });

  it("inline code still renders", () => {
    expect(renderMarkdown("`code`")).toContain("<code");
  });
});
