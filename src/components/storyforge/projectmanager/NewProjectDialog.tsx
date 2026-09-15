import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function NewProjectDialog({ open, value, onChange, onCancel, onConfirm }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Name your new project</DialogTitle>
          <DialogDescription>
            Give it a clear title — you can rename it later by editing the topic.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="new-project-name">Project name</Label>
          <Input
            id="new-project-name"
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onConfirm(); }}
            placeholder="e.g. The History of Coffee"
            maxLength={120}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm} disabled={!value.trim()}>Create project</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
