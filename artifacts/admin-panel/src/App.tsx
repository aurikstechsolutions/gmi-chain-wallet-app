import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import KYC from "@/pages/KYC";
import Merchants from "@/pages/Merchants";
import Disputes from "@/pages/Disputes";
import Settings from "@/pages/Settings";
import Escrow from "@/pages/Escrow";
import Legal from "@/pages/Legal";
import { LayoutDashboard, BadgeCheck, Store, AlertTriangle, LogOut, Settings as SettingsIcon, Lock, FileText, LayoutGrid, Coins, DollarSign, MonitorDot, Brain } from "lucide-react";
import DApps from "@/pages/DApps";
import Tokens from "@/pages/Tokens";
import Prices from "@/pages/Prices";
import Monitor from "@/pages/Monitor";
import BotAI from "@/pages/BotAI";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});

function Nav({ onLogout }: { onLogout: () => void }) {
  const [location, navigate] = useLocation();

  const links = [
    { href: "/", label: "Dashboard", Icon: LayoutDashboard },
    { href: "/kyc", label: "KYC", Icon: BadgeCheck },
    { href: "/merchants", label: "Merchants", Icon: Store },
    { href: "/disputes", label: "Disputes", Icon: AlertTriangle },
    { href: "/escrow", label: "Escrow", Icon: Lock },
    { href: "/dapps", label: "DApps", Icon: LayoutGrid },
    { href: "/tokens", label: "Tokens", Icon: Coins },
    { href: "/prices", label: "Prices", Icon: DollarSign },
    { href: "/legal", label: "Legal", Icon: FileText },
    { href: "/settings", label: "Settings", Icon: SettingsIcon },
    { href: "/monitor", label: "VPS Monitor", Icon: MonitorDot },
    { href: "/bot-ai",  label: "Bot AI",      Icon: Brain },
  ];

  return (
    <aside className="w-56 min-h-screen bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="px-5 py-5 flex items-center gap-2.5 border-b border-sidebar-border">
         <img src="/gmi-logo.png" alt="GMI" className="w-7 h-7 rounded-md object-cover" />
         <span className="font-semibold text-sidebar-foreground tracking-tight text-sm">GMI Admin</span>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {links.map(({ href, label, Icon }) => {
          const active = location === href;
          return (
            <button
              key={href}
              onClick={() => navigate(href)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left
                ${active
                  ? "bg-primary/15 text-primary font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
            >
              <Icon size={16} />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}

function AppShell() {
  const qc = useQueryClient();
  const [authed, setAuthed] = useState(() => !!localStorage.getItem("adminKey"));

  function handleLogin(key: string) {
    localStorage.setItem("adminKey", key);
    setAuthed(true);
  }

  function handleLogout() {
    localStorage.removeItem("adminKey");
    qc.clear();
    setAuthed(false);
  }

  if (!authed) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Nav onLogout={handleLogout} />
      <main className="flex-1 overflow-auto">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/kyc" component={KYC} />
          <Route path="/merchants" component={Merchants} />
          <Route path="/disputes" component={Disputes} />
          <Route path="/escrow" component={Escrow} />
          <Route path="/dapps" component={DApps} />
          <Route path="/tokens" component={Tokens} />
          <Route path="/prices" component={Prices} />
          <Route path="/legal" component={Legal} />
          <Route path="/settings" component={Settings} />
          <Route path="/monitor" component={Monitor} />
          <Route path="/bot-ai"  component={BotAI} />
          <Route>
            <div className="p-8 text-muted-foreground">Page not found</div>
          </Route>
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppShell />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
