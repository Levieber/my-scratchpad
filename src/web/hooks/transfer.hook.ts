import { useMutation, useQuery } from "@tanstack/react-query";

import { api, isApiError } from "@/web/lib/api";
import { saveFile } from "@/web/lib/download";
import { handle } from "@/web/lib/failures";
import { keys, queryClient, refetchNotes } from "@/web/lib/queries";
import { exportFilename } from "@/web/lib/transfer";

/**
 * What an import may send. Loaded once: it is the operator's setting. A server without import
 * answers `notFound`, read as null, and the app then offers neither export nor import (an older
 * server has no export either). While it loads, null too: nothing flashes in and out.
 */
export function useImportLimits() {
  return (
    useQuery({
      queryKey: keys.importLimits,
      queryFn: () =>
        api.importLimits().catch((e: unknown) => {
          if (isApiError(e, "notFound")) return null;
          throw e;
        }),
      staleTime: Infinity,
    }).data ?? null
  );
}

/** Saves the notes a search lists (all of them for none), as a file. Failures are worded by `handle`. */
export function useExport() {
  const { mutate, isPending } = useMutation({
    mutationFn: async ({ q, history }: { q: string; history: boolean }) => {
      const archive = await api.exportArchive(q, history);
      saveFile(exportFilename(archive.exported_at), JSON.stringify(archive, null, 2) + "\n");
    },
    onError: handle,
  });
  return {
    exporting: isPending,
    exportNotes: (q: string, history: boolean) => mutate({ q, history }),
  };
}

/**
 * Sends a file's JSON to the server. It resolves with the server's account of what it did, and
 * rejects with its refusal, for the form to word. What it changed is then asked for again: the
 * notes, their tags, views and pins, and the hook choices.
 */
export function useImport() {
  const { mutateAsync, isPending } = useMutation({
    mutationFn: (archive: unknown) => api.importArchive(archive),
    onSuccess: () =>
      Promise.all([refetchNotes(), queryClient.invalidateQueries({ queryKey: keys.hooks })]),
  });
  return { importing: isPending, importArchive: mutateAsync };
}
