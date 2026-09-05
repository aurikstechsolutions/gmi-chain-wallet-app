import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { get } from "@/lib/api";

export default function Login({ onLogin }: { onLogin: (key: string) => void }) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;

    setLoading(true);
    setError("");
    localStorage.setItem("adminKey", key.trim());

    try {
      await get("/stats");
      onLogin(key.trim());
    } catch (err) {
      localStorage.removeItem("adminKey");
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        setError("Invalid admin key. Please try again.");
      } else {
        setError("Connection error. Is the API server running?");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl overflow-hidden mb-4">
            <img src="/gmi-logo.png" alt="GMI logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">GMI Chain Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">Enter your admin key to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="Admin key"
              className="w-full px-4 py-3 rounded-lg bg-card border border-card-border text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 pr-11"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShow(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !key.trim()}
            className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {loading ? "Verifying…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
