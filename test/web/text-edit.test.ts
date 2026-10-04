import { describe, expect, test } from "bun:test";

import { continueList, link, setLines, type TextSel, wrap } from "@/web/lib/text-edit";

/** A selection written inline: `[` and `]` mark it, `|` a cursor. */
const sel = (marked: string): TextSel => {
  const cursor = marked.indexOf("|");
  if (cursor !== -1) return { value: marked.replace("|", ""), start: cursor, end: cursor };
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { value: marked.replace("[", "").replace("]", ""), start, end };
};

/** The other way round, to read a result. */
const show = ({ value, start, end }: TextSel) =>
  start === end
    ? `${value.slice(0, start)}|${value.slice(start)}`
    : `${value.slice(0, start)}[${value.slice(start, end)}]${value.slice(end)}`;

describe("wrap", () => {
  test("puts the marks around the selection and keeps it selected", () => {
    expect(show(wrap(sel("a [word] b"), "**"))).toBe("a **[word]** b");
  });

  test("takes them off again, from inside or around", () => {
    expect(show(wrap(sel("a **[word]** b"), "**"))).toBe("a [word] b");
    expect(show(wrap(sel("a [**word**] b"), "**"))).toBe("a [word] b");
  });

  test("with nothing selected, the pair with the cursor between", () => {
    expect(show(wrap(sel("a |b"), "_"))).toBe("a _|_b");
  });
});

describe("link", () => {
  test("the selection becomes the text, with `url` selected to type over", () => {
    expect(show(link(sel("see [docs] now")))).toBe("see [docs]([url]) now");
  });

  test("a selected address becomes the target, the cursor where the text goes", () => {
    expect(show(link(sel("[https://x.com]")))).toBe("[|](https://x.com)");
  });
});

describe("setLines", () => {
  test("makes the lines a checklist, replacing bullets and keeping indents", () => {
    expect(setLines(sel("[a\n- b\n  c]"), "task").value).toBe("- [ ] a\n- [ ] b\n  - [ ] c");
  });

  test("turns them back into plain lines when they already are", () => {
    const tasks = "- [ ] a\n- [x] b";
    expect(setLines({ value: tasks, start: 0, end: tasks.length }, "task").value).toBe("a\nb");
    expect(setLines(sel("## Ti|tle"), "heading").value).toBe("Title");
  });

  test("a heading in place of a list item, and the cursor stays on its word", () => {
    expect(show(setLines(sel("- Ti|tle"), "heading"))).toBe("## Ti|tle");
    expect(show(setLines(sel("Ti|tle"), "bullet"))).toBe("- Ti|tle");
  });

  test("touches only the lines the selection is on", () => {
    expect(setLines(sel("one\n[two]\nthree"), "bullet").value).toBe("one\n- two\nthree");
  });
});

describe("continueList", () => {
  test("Enter in an item starts the next one, a task if it was one", () => {
    expect(show(continueList(sel("- [x] done|"))!)).toBe("- [x] done\n- [ ] |");
    expect(show(continueList(sel("  * item|\nafter"))!)).toBe("  * item\n  * |\nafter");
  });

  test("numbers the next item", () => {
    expect(show(continueList(sel("1. one|"))!)).toBe("1. one\n2. |");
  });

  test("splits an item where the cursor is", () => {
    expect(show(continueList(sel("- ab|cd"))!)).toBe("- ab\n- |cd");
  });

  test("Enter on an empty item ends the list", () => {
    expect(show(continueList(sel("- a\n- [ ] |"))!)).toBe("- a\n|");
    expect(show(continueList(sel("- a\n- |\nnext"))!)).toBe("- a\n|\nnext");
  });

  test("outside a list, before its marker, or with a selection, Enter is left alone", () => {
    expect(continueList(sel("plain|"))).toBeNull();
    expect(continueList(sel("|- item"))).toBeNull();
    expect(continueList(sel("- [it]em"))).toBeNull();
  });
});
