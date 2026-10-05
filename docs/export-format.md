# The export archive

The archive is how a user takes their notes out of one deployment and into another (self-hosted to cloud, or back), and it is their backup. A file written today must still import years from now, into any deployment. So it has a written format and a version, and it is not "whatever `pad ls --json` prints".

`GET /api/export` writes it, `POST /api/import` reads it. `pad export` / `pad import` and the PWA's Settings → Data use those two. Code: `src/shared/archive.ts` (the shape and `parseArchive`, pure), `src/server/storage/transfer.ts` (both ends on SQLite), `src/server/transfer.ts` (HTTP).

## Version 2 (current)

One JSON object:

```json
{
  "format": "pad-export",
  "version": 2,
  "exported_at": "2026-10-04T12:00:00.000Z",
  "source": { "app_version": "0.1.0" },
  "notes": [
    {
      "id": "…",
      "title": "…",
      "body": "…",
      "tags": ["…"],
      "kind": "note",
      "author": "human",
      "created_at": "…",
      "updated_at": "…",
      "revisions": [
        {
          "title": "…",
          "body": "…",
          "tags": [],
          "kind": "note",
          "author": "claude-code",
          "updated_at": "…",
          "added": 1,
          "removed": 0
        }
      ]
    }
  ],
  "views": [
    { "id": "…", "name": "…", "query": "…", "layout": "table", "options": {}, "created_at": "…" }
  ],
  "pins": [{ "note_id": "…", "pinned_at": "…" }],
  "hook_selections": [
    {
      "hook": "review",
      "scope": "",
      "query": null,
      "include": [],
      "limit": 100,
      "updated_at": "…",
      "updated_by": "human"
    }
  ]
}
```

- **Notes** carry everything a note has but `progress`, which is derived from the body on every read. Timestamps are what `toISOString()` writes.
- **Revisions** are the note's history, **oldest first**. They are not given the database's own ids or the note's id: those mean nothing in another database, and the order of the list is the order of the history. `added` and `removed` (lines) may be left out; the importer counts them again.
- **Authors** are display strings (`human`, `claude-code`), never accounts. An import keeps whatever the archive says, and writes as the sender where it says nothing, so an import can attribute a note to anyone. Identity is deliberately not part of the archive.
- **Pages**: a note's `parent_id` is the note it is under, by its id in the same archive (null or left out: at the top). Added to version 2 without a new version: an older reader leaves it out and imports every note at the top. A reader that knows it sets parents once every note is in, so a page may come after what is under it; a parent that isn't in the database, or would make a loop, fails alone (`parent of <id>`) and the note stays at the top. An export narrowed to some notes writes `parent_id: null` for a page it leaves out, so it imports clean. `subpages` is counted on each read, so it is never written.
- **Views** carry how they are shown: `layout` (null or left out: each device's own choice) and its `options` (see `src/shared/layouts.ts`), added to version 2 without a new version, since an older reader just leaves them out. A layout the importing server doesn't know is kept, as clients show it as the list; an option it can't read is left out alone.
- **Pins** are in the order they were pinned. **Hook selections** are the notes each agent hook shows, per scope.
- `GET /api/export?history=false` leaves `revisions` out. With the list's filters (`q`, `kind`, `author`, `tag`) it holds only the notes they match and the pins on those: views and hook selections are the user's own setup, not part of a subset, so they are `[]`.

## Version 1

A bare JSON array of notes, as `pad export` wrote it before the archive existed (the same objects as `GET /api/notes`). It has no history, views, pins or hook selections. It is still read: each note's history starts at what it is, with its own author and dates.

## Reading rules

These are what keep old files working, so they are tested against committed fixtures (`test/fixtures/export-v1.json`, `export-v2.json`) on every run. Do not edit a fixture to make a test pass: a reader that stops reading one has broken the contract.

- **A newer version is refused, whole, before anything is written**: `422 unsupportedFormat`, naming the newest version the server reads. Reading it might misread what a later version changed.
- **Fields a reader doesn't know are left out, never fatal**, in the archive and in each item, so a newer deployment's extra data doesn't stop an older one from importing the rest.
- **A bad item fails alone.** It is listed in `failed` (`{ item, message }`, e.g. `note 3`) and the rest import. An archive that isn't one at all (`format` missing or wrong, notes not a list) is `400 invalidImport`.
- **Only a note's content is required**: a body or a title. What an archive leaves out of a note is filled in (a new id, the sender as author, the time of the import as its dates).
- **An id that already exists is skipped** and left exactly as it is, so importing a file twice changes nothing. A view whose name exists, and a hook selection for a hook and scope already stored, are skipped the same way. Pins, and the notes a hook selection picks, apply only to notes this import created; a hand-picked note that doesn't exist is dropped, as it is when a picked note is deleted. Pins past the limit are reported in `failed`, not fatal.
- **Each note is one transaction**, with its revisions inserted as they are (no folding of saves close together, which live edits get). The full-text index follows through the table's triggers.

## Limits

The most bytes one import may send is the operator's choice: `PAD_MAX_IMPORT_BYTES` (64 MiB by default). Over it the answer is `413 payloadTooLarge`. `GET /api/import` returns `{ formats, max_bytes }`, so a client can check before it uploads, and tell a server that imports at all from one that doesn't (an older one answers 404).

Import is synchronous and answers `{ created, skipped, failed, views, pins, hook_selections }`. If importing ever has to run in the background, that is a new resource beside this one, not a change to it.

Export is always offered: leaving a deployment must stay possible.

## Changing the format

Add fields freely (readers ignore what they don't know). Change the `version` only when an older reader would misread the file, and keep reading every older version. Update `src/shared/archive.ts`, this document and the OpenAPI schema together, and add a fixture for the new version.
