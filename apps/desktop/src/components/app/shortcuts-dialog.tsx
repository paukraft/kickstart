import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatShortcutGroupAccelerators, getShortcutDefinitionsForDialog } from "@/lib/shortcuts";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const dialogSections = getShortcutDefinitionsForDialog();

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Generated from Kickstart&apos;s shared shortcut registry so the menu and this list stay in
            sync.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 max-h-[70vh] overflow-y-auto px-4">
          <div className="space-y-5">
            {dialogSections.map((section) => (
              <section key={section.title}>
                <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {section.title}
                </h2>
                <div className="overflow-hidden rounded-lg border">
                  {section.rows.map((row, index) => (
                    <div
                      key={row.id}
                      className={[
                        "flex items-center justify-between gap-4 px-3 py-2.5",
                        index > 0 ? "border-t" : "",
                      ].join(" ")}
                    >
                      <span className="text-sm">{row.label}</span>
                      <kbd className="rounded-md border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                        {formatShortcutGroupAccelerators(row.accelerators)}
                      </kbd>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
