import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { tasks } from "@/shared/checklist";
import { NoteMarkdown } from "@/web/components/editor/note-markdown";
import { toggleTask } from "@/web/lib/checklist-edit";
import { readNote } from "@/web/lib/note-markdown";

const render = (body: string, editable = true) =>
  renderToStaticMarkup(
    editable ? <NoteMarkdown body={body} onToggle={() => {}} /> : <NoteMarkdown body={body} />,
  );

/** The rendered boxes: their label, whether ticked, whether a click can tick them. */
const boxes = (html: string) =>
  [...html.matchAll(/<span[^>]*role="checkbox"[^>]*>/g)].map(([tag]) => ({
    label: /aria-label="([^"]*)"/.exec(tag)?.[1],
    checked: tag.includes('aria-checked="true"'),
    disabled: tag.includes('aria-disabled="true"'),
  }));

describe("the Read view's checkboxes", () => {
  test("are numbered in the order of their lines, nested ones included", () => {
    const body = "- [ ] a\n  - [x] a.1\n- [ ] b";
    expect(boxes(render(body))).toEqual([
      { label: "a", checked: false, disabled: false },
      { label: "a.1", checked: true, disabled: false },
      { label: "b", checked: false, disabled: false },
    ]);
  });

  test("the Nth box toggles the Nth task line, past an empty placeholder", () => {
    const body = "- [ ]\n- [ ] first\n- [x] second";
    const html = render(body);
    // The placeholder is text, not a box, in the renderer as in `progress`.
    expect(html).toContain("[ ]");
    expect(boxes(html).map((b) => b.label)).toEqual(["first", "second"]);
    expect(toggleTask(body, 1)).toBe("- [ ]\n- [ ] first\n- [ ] second");
  });

  test("stay read-only where the renderer and progress read the body differently", () => {
    // A task in a quote renders as one, but isn't counted: the boxes can't be trusted to map.
    const body = "- [ ] counted\n\n> - [ ] quoted";
    expect(readNote(body).editable).toBe(false);
    expect(tasks(body)).toHaveLength(1);
    expect(boxes(render(body)).every((b) => b.disabled)).toBe(true);
  });

  test("without a handler, nothing can be ticked", () => {
    expect(boxes(render("- [ ] a", false))).toEqual([
      { label: "a", checked: false, disabled: true },
    ]);
  });
});

describe("rendering is a trust boundary", () => {
  const hostile = [
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    "<iframe src=https://evil.example></iframe>",
    "[click](javascript:alert(1))",
    "[click](JaVaScRiPt:alert(1))",
    "[click](  javascript:alert(1)  )",
    "[click](data:text/html,<script>alert(1)</script>)",
    "![x](javascript:alert(1))",
    '<a href="javascript:alert(1)">x</a>',
    "<svg onload=alert(1)>",
    "[ref]\n\n[ref]: javascript:alert(1)",
    "- [ ] <script>alert(1)</script>",
    "| a |\n|---|\n| <img src=x onerror=alert(1)> |",
    '<https://x.example/"onmouseover="alert(1)>',
  ];

  // Only real tags count: hostile markup shown as text is escaped (`&lt;script&gt;`), harmless.
  const tags = (html: string) => html.match(/<[a-z][^>]*>/gi) ?? [];

  test.each(hostile)("%p: no script, no handler, no executable link", (body) => {
    for (const tag of tags(render(body))) {
      expect(tag).not.toMatch(/^<(script|iframe|img|object|embed)\b/i);
      // The only SVGs are the app's own icons.
      if (/^<svg\b/i.test(tag)) expect(tag).toContain('class="lucide');
      expect(tag).not.toMatch(/\son\w+=/i);
      expect(tag).not.toMatch(/(href|src)="\s*(javascript|data|vbscript):/i);
    }
  });

  test("raw HTML is shown as the text it is", () => {
    expect(render("<b>bold?</b>")).toContain("&lt;b&gt;bold?&lt;/b&gt;");
  });

  test("syntax the renderer doesn't know reads as plain text", () => {
    const html = render("See [[another note]] and {{pad:thing}}.");
    expect(html).toContain("[[another note]]");
    expect(html).toContain("{{pad:thing}}");
  });

  test("addresses become links that open outside the app", () => {
    const html = render("<https://a.example/x> and https://b.example/y.");
    expect(html).toContain('href="https://a.example/x"');
    expect(html).toContain('href="https://b.example/y"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
