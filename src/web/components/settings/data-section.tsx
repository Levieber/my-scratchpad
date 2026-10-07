import { Field } from "@base-ui/react/field";
import { useRef, useState } from "react";

import type { ImportResult } from "@/shared/archive";
import { SettingsSection } from "@/web/components/settings/settings-section";
import { Button } from "@/web/components/ui/button";
import { Checkbox } from "@/web/components/ui/checkbox";
import { useOnline } from "@/web/hooks/online.hook";
import { useExport, useImport, useImportLimits } from "@/web/hooks/transfer.hook";
import { refusal } from "@/web/lib/failures";
import { importSummary, readImportFile, tooLarge } from "@/web/lib/transfer";

type Outcome = { result: ImportResult } | { error: string } | null;

/**
 * Taking the notes out and putting them back: the archive of docs/export-format.md. Absent from a
 * server that can't import, since an older one has no export either.
 */
export function DataSection() {
  const limits = useImportLimits();
  const online = useOnline();
  const { exporting, exportNotes } = useExport();
  const { importing, importArchive } = useImport();
  const [history, setHistory] = useState(true);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  if (!limits) return null;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    const large = tooLarge(file.size, limits.max_bytes);
    if (large) return setOutcome({ error: large });
    const read = readImportFile(await file.text());
    if ("error" in read) return setOutcome({ error: read.error });
    try {
      setOutcome({ result: await importArchive(read.data) });
    } catch (e) {
      // The server's refusal (a newer version, a file that isn't an archive) is the answer. Offline
      // or a missing token is already on screen elsewhere, and leaves nothing to say here.
      const message = refusal(e);
      setOutcome(message ? { error: message } : null);
    }
  };

  return (
    <SettingsSection
      id="data"
      title="Data"
      description="Your notes are yours. Export them all, with their history, saved searches and pins, to keep a backup or to move to another server; importing a file adds what it has and never changes a note that is already here."
      unavailable={!online && "Export and import need the server."}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          variant="outline"
          disabled={!online || exporting}
          onClick={() => exportNotes("", history)}
        >
          Export all
        </Button>
        <Field.Root>
          <Field.Label className="flex items-center gap-2 text-sm">
            <Checkbox className="size-6" checked={history} onCheckedChange={setHistory} />
            Include history
          </Field.Label>
        </Field.Root>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          variant="outline"
          disabled={!online || importing}
          onClick={() => fileInput.current?.click()}
        >
          Import…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          aria-label="Import file"
          className="hidden"
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            // The same file again must count as a choice.
            e.target.value = "";
          }}
        />
        <span className="text-xs text-muted-foreground">
          A file made by Export (or `pad export`), up to {Math.floor(limits.max_bytes / 1024 ** 2)}{" "}
          MB.
        </span>
      </div>
      {outcome && "error" in outcome && (
        <p role="alert" className="text-sm text-destructive">
          {outcome.error}
        </p>
      )}
      {outcome && "result" in outcome && <ImportOutcome result={outcome.result} />}
    </SettingsSection>
  );
}

function ImportOutcome({ result }: { result: ImportResult }) {
  return (
    <output className="flex flex-col gap-1 text-sm">
      {importSummary(result).map((line) => (
        <span key={line}>{line}</span>
      ))}
      {result.failed.length > 0 && (
        <>
          <span className="text-destructive">
            {result.failed.length === 1 ? "1 item" : `${result.failed.length} items`} could not be
            imported:
          </span>
          <ul className="list-disc pl-5 text-destructive">
            {result.failed.map((f) => (
              <li key={`${f.item}:${f.message}`}>
                {f.item}: {f.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </output>
  );
}
