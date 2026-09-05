import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, FileText, Shield } from "lucide-react";

const adminKey = () => localStorage.getItem("adminKey") ?? "";

async function fetchLegal(): Promise<{ terms: string; privacy: string }> {
  const res = await fetch("/api/legal/content");
  if (!res.ok) throw new Error("Failed to load");
  return res.json();
}

async function saveLegal(body: { terms?: string; privacy?: string }) {
  const res = await fetch("/api/legal/content", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": adminKey() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to save");
  return res.json();
}

export default function Legal() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [terms, setTerms] = useState("");
  const [privacy, setPrivacy] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["legal"],
    queryFn: fetchLegal,
  });

  useEffect(() => {
    if (data) {
      setTerms(data.terms ?? "");
      setPrivacy(data.privacy ?? "");
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: saveLegal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["legal"] });
      toast({ title: "Saved", description: "Legal content updated successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save legal content.", variant: "destructive" });
    },
  });

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Legal Content</h1>
        <p className="text-sm text-muted-foreground">
          Manage the Terms &amp; Conditions and Privacy Policy shown in the mobile app.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="animate-spin" size={16} />
          Loading…
        </div>
      ) : (
        <div className="space-y-8">
          {/* Terms */}
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={18} className="text-primary" />
              <Label className="text-base font-semibold">Terms &amp; Conditions</Label>
            </div>
            <Textarea
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="Enter your Terms & Conditions here…"
              className="min-h-[260px] font-mono text-sm resize-y"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{terms.length} characters</span>
              <Button
                size="sm"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ terms })}
              >
                {mutation.isPending ? <Loader2 className="animate-spin mr-1" size={14} /> : <Save size={14} className="mr-1" />}
                Save Terms
              </Button>
            </div>
          </div>

          {/* Privacy */}
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={18} className="text-primary" />
              <Label className="text-base font-semibold">Privacy Policy</Label>
            </div>
            <Textarea
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value)}
              placeholder="Enter your Privacy Policy here…"
              className="min-h-[260px] font-mono text-sm resize-y"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{privacy.length} characters</span>
              <Button
                size="sm"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ privacy })}
              >
                {mutation.isPending ? <Loader2 className="animate-spin mr-1" size={14} /> : <Save size={14} className="mr-1" />}
                Save Policy
              </Button>
            </div>
          </div>

          <div className="bg-muted/40 rounded-lg border border-border p-4 text-sm text-muted-foreground">
            <strong className="text-foreground">Tip:</strong> You can use plain text. Changes take effect immediately after saving — the app fetches content live.
          </div>
        </div>
      )}
    </div>
  );
}
