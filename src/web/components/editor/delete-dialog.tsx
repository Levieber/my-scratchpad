import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/web/components/ui/alert-dialog";
import { deleting } from "@/web/hooks/editor.hook";
import { useStore } from "@/web/hooks/store.hook";
import type { Note } from "@/web/lib/api";
import { session } from "@/web/lib/session";

/** Asks before a note is deleted. A dialog of the page, so it works in an installed PWA and on iOS. */
export function DeleteDialog() {
  const note = useStore(deleting);
  // Still named while the dialog animates out.
  const [named, setNamed] = useState<Note | null>(null);
  if (note && note !== named) setNamed(note);
  return (
    <AlertDialog open={note !== null} onOpenChange={(open) => !open && deleting.set(null)}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="wrap-anywhere">Delete "{named?.title}"?</AlertDialogTitle>
          <AlertDialogDescription>Its history goes with it.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (note) session.remove(note);
              deleting.set(null);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
