import { useQuery } from "@tanstack/react-query";
import { get, type Stats } from "@/lib/api";
import { LayoutDashboard, Users, BadgeCheck, Store, AlertTriangle, FileText, ShoppingCart, Clock } from "lucide-react";

function StatCard({ label, value, icon: Icon, accent }: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent?: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${accent ?? "bg-primary/15"}`}>
        <Icon size={20} className={accent ? "text-white" : "text-primary"} />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading, error } = useQuery<Stats>({
    queryKey: ["admin", "stats"],
    queryFn: () => get<Stats>("/stats"),
  });

  if (isLoading) {
    return (
      <div className="p-8 flex items-center gap-3 text-muted-foreground text-sm">
        <Clock size={16} className="animate-spin" />
        Loading stats…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-destructive text-sm">
        Failed to load stats: {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-2.5 mb-6">
        <LayoutDashboard size={20} className="text-primary" />
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <StatCard label="Total Profiles" value={data?.totalProfiles ?? 0} icon={Users} />
        <StatCard
          label="Pending KYC"
          value={data?.pendingKyc ?? 0}
          icon={Clock}
          accent={data?.pendingKyc ? "bg-amber-500/20" : undefined}
        />
        <StatCard label="Verified KYC" value={data?.verifiedKyc ?? 0} icon={BadgeCheck} accent="bg-emerald-500/20" />
        <StatCard label="Merchants" value={data?.merchants ?? 0} icon={Store} />
        <StatCard
          label="Open Disputes"
          value={data?.openDisputes ?? 0}
          icon={AlertTriangle}
          accent={data?.openDisputes ? "bg-red-500/20" : undefined}
        />
        <StatCard label="Total Ads" value={data?.totalAds ?? 0} icon={FileText} />
        <StatCard label="Total Orders" value={data?.totalOrders ?? 0} icon={ShoppingCart} />
      </div>

      {(data?.pendingKyc ?? 0) > 0 && (
        <div className="mt-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
          <Clock size={16} className="text-amber-400 flex-shrink-0" />
          <p className="text-sm text-amber-300">
            <span className="font-semibold">{data?.pendingKyc}</span> KYC submission{data?.pendingKyc !== 1 ? "s" : ""} waiting for review.
            Go to the <span className="font-semibold">KYC</span> tab to approve or reject.
          </p>
        </div>
      )}

      {(data?.openDisputes ?? 0) > 0 && (
        <div className="mt-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-300">
            <span className="font-semibold">{data?.openDisputes}</span> open dispute{data?.openDisputes !== 1 ? "s" : ""} need resolution.
            Go to the <span className="font-semibold">Disputes</span> tab.
          </p>
        </div>
      )}
    </div>
  );
}
