import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import {
  Shield, Lock, CheckCircle, RefreshCw, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Wallet, ArrowRightLeft,
  Eye, EyeOff, Copy, Check,
} from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface EscrowInfo {
  configured: boolean;
  escrowAddress: string | null;
}

interface WalletStatus {
  configured: boolean;
  address: string | null;
  mc: string;
  usdt: string;
  lockedOrders: number;
}

interface EscrowOrder {
  id: string;
  buyerAddress: string;
  sellerAddress: string;
  token: "MC" | "USDT";
  cryptoAmount: string;
  fiatAmount: string;
  price: string;
  status: string;
  escrowStatus: string;
  escrowTxHash?: string;
  releaseTxHash?: string;
  escrowLockedAt?: string;
  createdAt: string;
}

interface EscrowOrdersResponse {
  orders: EscrowOrder[];
  total: number;
  escrowAddress: string | null;
}

interface MigrateResult {
  migrated: boolean;
  oldAddress?: string;
  newAddress: string;
  mcMoved?: string;
  usdtMoved?: string;
  txHashes?: { mc?: string; usdt?: string };
  message?: string;
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-5)}`;
}

function escrowStatusBadge(s: string) {
  if (s === "locked")   return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (s === "released") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (s === "refunded") return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  return "bg-muted/50 text-muted-foreground border-border";
}

export default function Escrow() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [confirmId,  setConfirmId]  = useState<{ id: string; action: "release" | "refund" } | null>(null);
  const [reason,     setReason]     = useState("");
  const [showMigrate, setShowMigrate] = useState(false);
  const [newAddress,  setNewAddress]  = useState("");
  const [newPrivKey,  setNewPrivKey]  = useState("");
  const [showKey,     setShowKey]     = useState(false);
  const [copied,      setCopied]      = useState(false);
  const [migrateResult, setMigrateResult] = useState<MigrateResult | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: walletStatus, isLoading: walletLoading, refetch: refetchWallet } = useQuery<WalletStatus>({
    queryKey: ["admin", "escrow-wallet"],
    queryFn: () => get<WalletStatus>("/escrow/wallet"),
    refetchInterval: 30_000,
  });

  const { data: escrowOrders, isLoading: ordersLoading } = useQuery<EscrowOrdersResponse>({
    queryKey: ["admin", "escrow-orders"],
    queryFn: () => get<EscrowOrdersResponse>("/escrow/orders"),
    refetchInterval: 30_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const releaseMut = useMutation({
    mutationFn: ({ id }: { id: string }) => post(`/escrow/orders/${id}/release`),
    onSuccess: () => {
      toast({ title: "Released", description: "Escrow released to buyer on-chain." });
      setConfirmId(null);
      qc.invalidateQueries({ queryKey: ["admin", "escrow-orders"] });
      qc.invalidateQueries({ queryKey: ["admin", "escrow-wallet"] });
    },
    onError: (e) => toast({ title: "Error", description: e instanceof Error ? e.message : "Release failed", variant: "destructive" }),
  });

  const refundMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => post(`/escrow/orders/${id}/refund`, { reason }),
    onSuccess: () => {
      toast({ title: "Refunded", description: "Escrow refunded to seller." });
      setConfirmId(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["admin", "escrow-orders"] });
      qc.invalidateQueries({ queryKey: ["admin", "escrow-wallet"] });
    },
    onError: (e) => toast({ title: "Error", description: e instanceof Error ? e.message : "Refund failed", variant: "destructive" }),
  });

  const migrateMut = useMutation({
    mutationFn: () => post<MigrateResult>("/escrow/migrate", { newAddress: newAddress.trim(), newPrivateKey: newPrivKey.trim() }),
    onSuccess: (data) => {
      setMigrateResult(data);
      setShowMigrate(false);
      setNewAddress("");
      setNewPrivKey("");
      qc.invalidateQueries({ queryKey: ["admin", "escrow-wallet"] });
      qc.invalidateQueries({ queryKey: ["admin", "escrow-orders"] });
      toast({ title: "Escrow wallet updated", description: data.migrated ? `Moved ${data.mcMoved} MC and ${data.usdtMoved} USDT to new wallet.` : data.message });
    },
    onError: (e) => toast({ title: "Migration failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" }),
  });

  // ── Derived values ────────────────────────────────────────────────────────
  const orders     = escrowOrders?.orders ?? [];
  const lockedMc   = orders.filter(o => o.escrowStatus === "locked" && o.token === "MC").reduce((s, o) => s + parseFloat(o.cryptoAmount), 0);
  const lockedUsdt = orders.filter(o => o.escrowStatus === "locked" && o.token === "USDT").reduce((s, o) => s + parseFloat(o.cryptoAmount), 0);
  const hasLockedOrders = (walletStatus?.lockedOrders ?? 0) > 0;

  function copyAddress() {
    if (!walletStatus?.address) return;
    navigator.clipboard.writeText(walletStatus.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2.5">
        <Shield className="text-primary" size={20} />
        <h1 className="text-xl font-semibold">Escrow Management</h1>
      </div>

      {/* ── Wallet status card ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-muted-foreground" />
            <span className="text-sm font-semibold">Escrow Wallet</span>
            {walletStatus?.configured
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Configured</span>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">Not configured</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { void refetchWallet(); }}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh balances"
            >
              <RefreshCw size={13} />
            </button>
            <button
              onClick={() => { setShowMigrate(true); setMigrateResult(null); }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted/40 transition-colors font-medium text-foreground"
            >
              <ArrowRightLeft size={12} />
              Update Wallet
            </button>
          </div>
        </div>

        {walletLoading ? (
          <div className="h-10 bg-muted/40 rounded-lg animate-pulse" />
        ) : walletStatus?.address ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 font-mono text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 break-all">
              {walletStatus.address}
            </div>
            <button
              onClick={copyAddress}
              className="p-2 rounded-lg border border-border hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground flex-shrink-0"
              title="Copy address"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No escrow wallet configured. Click <strong>Update Wallet</strong> to set one up, or set <code className="bg-muted px-1 rounded">P2P_ESCROW_ADDRESS</code> and <code className="bg-muted px-1 rounded">P2P_ESCROW_PRIVATE_KEY</code> environment variables.
          </p>
        )}

        {/* Live on-chain balances */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-xs text-muted-foreground mb-1">On-chain MC</div>
            <div className="text-base font-bold text-foreground">{walletStatus?.mc ?? "—"} MC</div>
            <div className="text-xs text-muted-foreground mt-0.5">gas + buffer</div>
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-xs text-muted-foreground mb-1">On-chain USDT</div>
            <div className="text-base font-bold text-foreground">{walletStatus?.usdt ?? "—"} USDT</div>
            <div className="text-xs text-muted-foreground mt-0.5">available</div>
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-xs text-muted-foreground mb-1">Locked MC</div>
            <div className="text-base font-bold text-amber-400">{lockedMc.toFixed(4)} MC</div>
            <div className="text-xs text-muted-foreground mt-0.5">in active orders</div>
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-xs text-muted-foreground mb-1">Locked USDT</div>
            <div className="text-base font-bold text-amber-400">{lockedUsdt.toFixed(4)} USDT</div>
            <div className="text-xs text-muted-foreground mt-0.5">in active orders</div>
          </div>
        </div>

        {/* Gas reminder */}
        {walletStatus?.configured && parseFloat(walletStatus.mc ?? "0") < 1 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25">
            <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-300">
              Low MC balance. The escrow wallet needs native MC to pay gas on every release, refund, or migration. Top up to at least a few hundred MC.
            </p>
          </div>
        )}
      </div>

      {/* ── Last migration result ──────────────────────────────────────── */}
      {migrateResult && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-3">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
            <CheckCircle size={16} /> Wallet {migrateResult.migrated ? "migrated" : "configured"} successfully
          </div>
          {migrateResult.migrated && (
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div>New address: <span className="font-mono text-foreground break-all">{migrateResult.newAddress}</span></div>
              <div>MC moved: <span className="text-foreground font-semibold">{migrateResult.mcMoved} MC</span></div>
              <div>USDT moved: <span className="text-foreground font-semibold">{migrateResult.usdtMoved} USDT</span></div>
              {migrateResult.txHashes?.mc   && <div>MC tx: <span className="font-mono">{migrateResult.txHashes.mc.slice(0, 18)}…</span></div>}
              {migrateResult.txHashes?.usdt && <div>USDT tx: <span className="font-mono">{migrateResult.txHashes.usdt.slice(0, 18)}…</span></div>}
            </div>
          )}
        </div>
      )}

      {/* ── Orders table ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <span className="text-sm font-semibold">Locked Escrow Orders</span>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ["admin", "escrow-orders"] })}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {ordersLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-2 text-muted-foreground">
            <CheckCircle size={32} className="opacity-30" />
            <span className="text-sm">No locked escrow orders</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs">
                  <th className="text-left px-4 py-3 font-medium">Amount</th>
                  <th className="text-left px-4 py-3 font-medium">Seller</th>
                  <th className="text-left px-4 py-3 font-medium">Buyer</th>
                  <th className="text-left px-4 py-3 font-medium">Escrow</th>
                  <th className="text-left px-4 py-3 font-medium">Order</th>
                  <th className="text-left px-4 py-3 font-medium">Locked At</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map(order => (
                  <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-semibold">
                      {parseFloat(order.cryptoAmount).toFixed(4)} {order.token}
                      <div className="text-xs text-muted-foreground font-normal">≈ {parseFloat(order.fiatAmount).toFixed(2)} USDT</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{shortAddr(order.sellerAddress)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{shortAddr(order.buyerAddress)}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full border font-medium ${escrowStatusBadge(order.escrowStatus)}`}>
                        {order.escrowStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{order.status}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {order.escrowLockedAt ? new Date(order.escrowLockedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {order.escrowStatus === "locked" && (
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => setConfirmId({ id: order.id, action: "release" })}
                            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors font-medium"
                          >
                            <ArrowUpRight size={12} />Release
                          </button>
                          <button
                            onClick={() => setConfirmId({ id: order.id, action: "refund" })}
                            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 transition-colors font-medium"
                          >
                            <ArrowDownRight size={12} />Refund
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Update wallet modal ────────────────────────────────────────── */}
      {showMigrate && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md space-y-5">
            <div className="flex items-center gap-2">
              <Wallet size={18} className="text-primary" />
              <span className="font-semibold text-base">Update Escrow Wallet</span>
            </div>

            {hasLockedOrders && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-300">
                  <strong>{walletStatus?.lockedOrders} locked order(s)</strong> are currently in escrow. All funds will be moved to the new wallet. Make sure the new wallet is correct before continuing.
                </p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                  New Wallet Address
                </label>
                <input
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder="mxc1… or 0x…"
                  value={newAddress}
                  onChange={e => setNewAddress(e.target.value)}
                  spellCheck={false}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                  Private Key (hex, no 0x prefix)
                </label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 pr-10 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    placeholder="abcdef1234…"
                    value={newPrivKey}
                    onChange={e => setNewPrivKey(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-muted/30 border border-border p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">What happens when you save:</p>
              <p>• All on-chain MC balance (minus 0.05 MC gas reserve) is sent to the new wallet</p>
              <p>• All USDT balance is sent to the new wallet</p>
              <p>• Future releases and refunds will use the new wallet</p>
              <p>• The new config is saved to disk and survives server restarts</p>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setShowMigrate(false); setNewAddress(""); setNewPrivKey(""); }}
                className="flex-1 px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!newAddress.trim() || !newPrivKey.trim() || migrateMut.isPending}
                onClick={() => migrateMut.mutate()}
                className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {migrateMut.isPending ? "Migrating…" : walletStatus?.configured ? "Migrate & Save" : "Save Wallet"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Release / Refund confirmation ──────────────────────────────── */}
      {confirmId && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className={confirmId.action === "release" ? "text-emerald-400" : "text-blue-400"} />
              <span className="font-semibold text-base capitalize">{confirmId.action} Escrow</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {confirmId.action === "release"
                ? "This will broadcast an on-chain transaction sending the locked funds to the buyer's wallet. This cannot be undone."
                : "This will refund the locked funds back to the seller's wallet."}
            </p>
            {confirmId.action === "refund" && (
              <div>
                <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide block mb-1.5">Reason</label>
                <input
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder="e.g. Dispute resolved in seller's favour"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setConfirmId(null); setReason(""); }}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={releaseMut.isPending || refundMut.isPending}
                onClick={() => {
                  if (confirmId.action === "release") releaseMut.mutate({ id: confirmId.id });
                  else refundMut.mutate({ id: confirmId.id, reason });
                }}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-60 ${
                  confirmId.action === "release" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {(releaseMut.isPending || refundMut.isPending) ? "Processing…" : `Confirm ${confirmId.action}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
