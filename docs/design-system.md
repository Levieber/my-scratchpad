# Design system

How the PWA looks and why, in one place: the tokens, the components built on them, the patterns for a busy scratchpad, and the checks that keep them from drifting. The mechanics of Tailwind and shadcn here (the build, the breakpoint, adding a component) are in "Styling the PWA" in [architecture.md](architecture.md).

Three layers, each built only on the one below:

1. **Tokens**: `src/web/index.css`, the only stylesheet. Colors, radii, text sizes, the focus ring, scrollbars, the content column.
2. **Primitives**: shadcn's components on Base UI (`src/web/components/ui/`), copied whole. They read the tokens by the names shadcn gives them, so they follow the theme with no edits. One caveat: Base UI marks a vertical group with `data-orientation`, not the `data-vertical` shadcn's styles read, so the place that uses a vertical one sets `flex-col` itself, as `Tabs` does.
3. **App components**: design-system parts this app adds on top (`src/web/components/shell/`): `Hint` (tooltips, with a shortcut's keys), `ChipToggle`, `ChipButton` and `ChipSelect` (`chip.tsx`), `QuietLink`, `QuietLinkButton` and `QuietButton` (`quiet.tsx`), `Row`, `ClickableCard` and `CoverButton`, `SectionLabel`, `ListMessage`, `FormField`, `DisclosureButton`, `MetaBadge`, `ThemeSwitcher`. Those that take another element's place (`Row`, `ClickableCard`, `SectionLabel`, `ListMessage`) take Base UI's `render` prop, as shadcn's `Badge` does: `<Row render={<li />}>`.

A feature component composes these and adds layout. It doesn't add a color, a radius, a text size or a focus style of its own: `test/web/styles.test.ts` fails if it does.

## Color

The palette is a set of variables named as shadcn names them, each mapped to a Tailwind color in `@theme inline`: `bg-card`, `text-muted-foreground`, `border-border` and so on. Never use a hex value or Tailwind's own palette (`bg-gray-100`).

| Role      | Token                       | Used for                                                            |
| --------- | --------------------------- | ------------------------------------------------------------------- |
| Page      | `background`, `foreground`  | the page, body text                                                 |
| Surface   | `card`, `popover`           | rows on hover, cards, menus, popovers                               |
| Quiet     | `muted`, `muted-foreground` | a board column, code; secondary text                                |
| Lines     | `border`, `input`           | dividers and cards; a field's or a toggle's border                  |
| Brand     | `primary`, `ring`           | the one main action, a pressed chip's border, links, the focus ring |
| Selected  | `accent` (= `secondary`)    | a pressed toggle or chip, the open menu trigger                     |
| Status    | `destructive`, `success`    | delete, errors, offline; online, a ticked task                      |
| Scrollbar | `scrollbar`                 | the thumb (`index.css`, base layer)                                 |

**Theme.** Each device picks System, Light or Dark (`ThemeSwitcher`, in the list's footer and in Settings under Appearance; `lib/theme.ts` keeps the choice in `localStorage`). The choice is `data-theme` on `<html>`, absent for System. The dark palette and Tailwind's `dark:` variant follow it through one custom variant in `index.css`: dark when `data-theme="dark"`, or when the device prefers dark and Light wasn't chosen. The dark values are written once, in `:root { @variant dark { … } }`. `color-scheme` changes with it, so native parts (scrollbars, date pickers) follow, and so do the toasts (`theme` on Sonner, `app.tsx`) and the browser's bar (`theme-color`, set by `lib/theme.ts`). The theme is applied in `main.tsx` before the first render: the CSP allows no inline script in the page's head, so a chosen theme that differs from the device's can show the device's for a frame on a slow load.

## Radius

One `--radius` (0.625rem, 10 px), scaled in `@theme inline`. shadcn's components read the same names.

| Class          | Size  | For                                                       |
| -------------- | ----- | --------------------------------------------------------- |
| `rounded-sm`   | 6 px  | small marks: inline code, a menu item                     |
| `rounded-md`   | 8 px  | controls: buttons, fields, toggles, the Read view's box   |
| `rounded-lg`   | 10 px | surfaces: list rows, cards, board columns, embedded views |
| `rounded-xl`   | 14 px | dialogs, shadcn's `Card` (a hook in Settings)             |
| `rounded-full` |       | chips and pills, dots                                     |

No `rounded-[…]` or radius of a component's own. (shadcn's Checkbox keeps its own 4 px: `ui/` is copied whole.)

## Type

Tailwind's scale (`text-xs` 12 px, `text-sm` 14 px, `text-base` 16 px; the body is 15 px), all in rem so the reader's text size applies, plus three roles it has no step for:

| Class          | Size  | For                                                                         |
| -------------- | ----- | --------------------------------------------------------------------------- |
| `text-title`   | 17 px | a page's title ("Scratchpad", "Settings"); tightened letter spacing         |
| `text-caption` | 13 px | the secondary line: previews, filter chips, the editor toolbar, the table   |
| `text-label`   | 11 px | small labels: a section's heading (uppercase), a badge inside the meta line |

Every size keeps a 1.5 line height (`--text-*--line-height`), so small chips stay 24 px tall. A size relative to the text around it (`text-[0.9em]` for inline code) is fine; a fixed one of a component's own (`text-[13px]`, `text-[0.8rem]`) is not. These three are registered with `cn` (`lib/utils.ts`). Without that, `cn` reads `text-caption` as a color and drops one of `text-caption` and `text-muted-foreground`. A new size goes in both places, and `test/web/utils.test.ts` checks that they match.

## Spacing

Tailwind's 4 px scale, in a few steps used the same way everywhere:

- `gap-1.5` between chips in a row, `gap-2` between controls, `gap-2.5` between the blocks of a column (search, filters, views, tags, list).
- `p-2.5` inside a list row, `p-3` inside a card, `p-4` inside a settings card (`p-3` on a phone).
- The content column's gutter: 12 px beside a note, 16 px on a phone, 20 px for the whole-screen list (`--gutter`).

## Focus

Every control shows the same ring: shadcn's 3 px halo of `ring` at half strength. shadcn's components have it built in. A control made here (a list row, a card's title, a tree node, an inline link) takes one of three utilities from `index.css`:

- `focus-ring`: the halo outside the element.
- `focus-ring-inset`: inside its edge, for a row flush with a scrolling list, whose edge would clip a halo.
- `focus-ring-cover`: on the `::after` that stretches a title's button over its whole card or table row.

No `focus-visible:outline-*` of a component's own. A focusable region shows the ring too (the Read view's panel, the splitter).

## Scrollbars and scroll areas

Scrollbars are thin and take the palette's `scrollbar` color, light and dark: Tailwind's `scrollbar-thin scrollbar-thumb-scrollbar scrollbar-track-transparent` on every element, in the base layer. The platform's default (arrows and a white track on Linux and Windows) was the loudest thing on the page.

The page itself never scrolls (the shell is one row, the screen's height). What is taller scrolls in its own column, and its scrollbar sits at that column's edge, beside what it scrolls:

- `scroll-column` (`index.css`): a `content-column` that scrolls, with a stable scrollbar gutter (`scrollbar-gutter-stable`), so nothing shifts when the list grows past the screen. It is positioned, so an `sr-only` label inside can't stretch the page. The list (`notes.tsx`) and Settings' page are each one.
- `aligned-column`: a column above or below a scroll column (the search, the footer). It keeps the same gutter, so its edges line up with the list's. Only a scroll container keeps a gutter, so it is `overflow-hidden` (and `flex-none`).

The wheel turned over the window's margins no longer scrolls the list: that came with a scroll area as wide as the window, whose scrollbar sat at the window's edge, far from the notes.

A list's scroll area spans the window, not just the column it shows. Its contents keep to `content-column` (centred, as wide as `--column` allows, with `--gutter` on either side). So the scrollbar sits at the window's edge, and a wheel turned over the margins scrolls the list. With the list as the whole screen, the scroll area reserves a gutter on both sides (`scrollbar-gutter: stable both-edges`), so the notes stay aligned under the search above them.

## Icons

`lucide-react` only; never a text glyph standing for an icon ("+", "●", "×").

- `size-4` (16 px) in controls, which shadcn's Button and Toggle give unasked; `size-3.5` in a compact control (the theme switcher); `size-3` inline with `text-xs` (the pin and agent marks in a note's meta line).
- An icon-only button has an `aria-label` and a `Hint`, which says the same or a little more. Base UI draws a tooltip for the eye only (no `role="tooltip"`, no `aria-describedby`), so the `aria-label` is what a screen reader hears. A menu trigger ("Options for …") is the exception: its menu says what it holds. A decorative icon is `aria-hidden`, or labelled where it carries meaning (Pinned).

## Components

- **One role, one component.** Two controls that do the same kind of thing look the same because they are the same component, not because their classes were copied: a class list repeated for a role becomes a part in `shell/`. `test/e2e/consistency.test.ts` compares what the browser draws (the footer's links) and checks a few roles' behaviour (every icon-only button has a tooltip; a toggle keeps its name).
- **Actions**: `Button`. `default` for the one main action on a screen (New, Save), `outline` for secondary ones, `ghost` in toolbars, `link` in the footer; `icon*` sizes for icon-only buttons.
- **Chips** (`shell/chip.tsx`): `ChipToggle`, a pressed-or-not chip inside a `ToggleGroup` (filters at `size="md"`, tags at `sm`). `ChipButton`, a dashed chip that does something rather than filtering ("All 62 tags", "+6 views", "Save this search", "Load more"). `ChipSelect`, a solid chip holding a setting's value, which opens its choices: a muted label, the value, a chevron (the board's "Columns status:… ⌄"). A saved view is a chip with its own delete button (`views/view-chip.tsx`).
- **Quiet links** (`shell/quiet.tsx`): the app's own links outside a note, in the footer (Export, Settings, API), the breadcrumbs, subpages and "Linked from". Muted, faintly underlined, 24 px tall. `QuietLink` is an `<a>` (going somewhere: a real address, so it opens in a new tab too), `QuietLinkButton` a `<button>` (running code, or opening a note in the app); both look the same. `QuietButton` is the quiet action beside them ("Subpage", "Open as search"). A link inside a note is the note's: `text-primary`, solid for an address, dotted for another note (`markdown-elements.tsx`). Nothing else is underlined (`styles.test.ts`).
- **Toggles**: `Toggle` and `ToggleGroup` items look pressed the same way everywhere (accent background, foreground text, muted when off). The look is set once in `ui/toggle.tsx`; a use never restyles `aria-pressed` (`styles.test.ts`), except the chips, which add a primary border. A toggle keeps one name, pressed or not: the state is `aria-pressed`, so the editor's Pin is "Pin" and pressed, never "Unpin".
- **Badges in a line of text**: `MetaBadge`, a size down from `Badge` (reference, an agent's name, the current revision); an outline one is muted.
- **Section labels**: `SectionLabel` (`text-label`, semibold, uppercase, wide tracking, muted): the list's "Pinned" and "Today", the board's columns.
- **Rows to pick from**: `Row`, flat until hovered, a card's surface while it is the one open (`current`): a note in the list, a page in the tree, a revision in History. The table's rows stay table rows (a border on a `<tr>` needs another border model).
- **Cards that open something**: `ClickableCard` with a `CoverButton`, whose `::after` stretches over the card (and over a table row: the table's title is one too), so a click anywhere opens it. Something else clickable inside sits above it (`relative z-10`). A card that is a panel rather than a link is shadcn's `Card` (a hook in Settings).
- **A list's own words**: `ListMessage` for what a list says in place of its items, or after them ("No matches.", "The 200 most recently changed…").
- **Showing and hiding**: `DisclosureButton`, a ghost `Button` with `aria-expanded` but without the expanded background shadcn gives a menu trigger, which would look held down for as long as the thing is shown: the note list beside the editor, the pages under a page. Its icon says the state.
- **Shortcuts**: `Hint`'s `keys` (`"Mod+B"`), drawn as shadcn's `Kbd` in the tooltip; `Mod` is ⌘ on a Mac and Ctrl elsewhere (`lib/keys.ts`, which also writes the search's placeholder).
- **Choices**: `ToggleGroup` for a radio or multi-select row (one tab stop, arrow keys inside); a vertical one sets `flex-col` where it is used (see the caveat above).
- **Overlays**: `Popover` for a small form or a list to pick from, `DropdownMenu` for a note's actions, `Dialog` and `AlertDialog`, `Tooltip` through `Hint`, Sonner's toasts for refusals.
- **Fields**: `FormField` (Base UI's `Field` with the one label and error look), around `Input` or `Textarea`, never under 1rem; `inline` puts the label before the field, in a row of settings.
- **Popovers** are never wider than the room beside their trigger (`max-w-(--available-width)`, which Base UI measures), in `ui/popover.tsx` itself.

## Patterns for a busy scratchpad

- **Long lists load as they scroll.** The list asks for 50 notes, then 50 more as its end comes within a screen of view (`ListEnd`: an `IntersectionObserver` on the "Load more" button, rooted in the list's scroll area). The button stays, for the keyboard and wherever the observer doesn't fire, and a `Loading…` status says when a page is on its way. Every layout that lists the search's notes (list, grid, table, board) ends with it.
- **A row of chips shows a few, and the rest are one chip away.** Tags show the most used (8 where the list is a wide screen, 4 on a phone and in the column beside a note), plus the selected ones wherever they rank (`visibleFirst`, `lib/listing.ts`). Every tag is in the tag picker, a popover that finds them by typing (`matchTags`) and stays open while several are picked. Saved views work the same way (6 and 3, with the view in force always shown), with the rest behind "+N views".
- **A pinned note is a row like any other**, with its preview and meta line, wherever the list is: pinned is where it is listed, not a smaller kind of note. A full set of pins (8) can push the latest notes below a phone's first screen.
- **Empty, loading and offline are states, not afterthoughts**: "No matches." / "No notes yet.", `Loading…` at the list's end, "offline" in the footer with the edits waiting to sync.

### Limits

| What                | How many                                                     | Where                              |
| ------------------- | ------------------------------------------------------------ | ---------------------------------- |
| Pinned notes        | 8 (the API refuses a 9th: `pinLimit`)                        | `MAX_PINS`, `src/shared/pins.ts`   |
| A page of the list  | 50, then 50 more each time                                   | `PAGE`, `hooks/search.hook.tsx`    |
| Tags shown as chips | 8 wide, 4 on a phone or beside a note, plus selected ones    | `components/notes/tag-chips.tsx`   |
| Saved views shown   | 6 wide, 3 on a phone or beside a note, plus the one in force | `components/views/saved-views.tsx` |
| Pages under a page  | the 200 latest; the tree says so past that                   | `MOST`, `hooks/pages.hook.ts`      |
| An embedded view    | its `limit` (10 by default)                                  | `src/shared/embeds.ts`             |

## Checked, not just written

- `test/web/styles.test.ts`, on the compiled CSS and the components' class lists: the radius scale comes from `--radius`; no `rounded-[…]`, fixed `text-[…]`, `focus-visible:outline-*`, `aria-pressed:*` or `underline` outside the design system's own files; the focus utilities exist; scrollbars are thin and themed in both palettes, and the scroll and aligned columns keep a gutter; every class of the app's own is in Tailwind's canonical form (`canonicalizeCandidates`, what its editor extension suggests), so a newer utility replaces an arbitrary value; the CSS is compiled by the Tailwind `package.json` pins; text in rem; fields at least 1rem; every size of Button, Toggle and the chips at least 24 px.
- `test/web/utils.test.ts`: `cn` keeps every size `index.css` adds beside a text color.
- `test/e2e/scroll.test.ts`: the list scrolls in its column (no wider than it, its scrollbar drawn), its rows end where the search's row does, and Settings scrolls in one place, never the page. The test browser draws scrollbars (headless Chrome hides them), so their gutters are measured.
- `test/e2e/busy.test.ts`: 120 notes load by scrolling, the tag picker finds and stacks tags, views past the first few are one chip away, and chips keep to two lines on a phone.
- `test/e2e/consistency.test.ts`: the footer's three links draw the same (size, weight, color, underline, height); the editor's Pin keeps its name when pressed; the board's Columns picker has a chip's shape; a pinned row matches any other, in the whole-screen list and beside an open note; every icon-only button in the list, a note and Settings shows a tooltip on hover.
- `test/e2e/theme.test.ts`: Dark and Light override the device and are remembered, System gives the choice back to the device, the browser's bar follows, and the footer holds the switcher at 320 px.
- `test/e2e/layout.test.ts` and `layouts.test.ts`: no sideways scroll, 24 px targets and 16 px fields at 320, 390 and 1280 px.
