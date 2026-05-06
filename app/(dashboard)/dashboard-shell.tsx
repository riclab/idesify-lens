"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardSidebar } from "./dashboard-sidebar";
import { SidebarContext } from "@/lib/sidebar-context";
import { cn } from "@/lib/utils";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const isChat = pathname.startsWith("/chat/");

  const sidebarCtx = useMemo(
    () => ({ open: sidebarOpen, toggle: toggleSidebar }),
    [sidebarOpen, toggleSidebar],
  );

  return (
    <SidebarContext value={sidebarCtx}>
      <div className="flex h-dvh min-h-0 w-full overflow-hidden">
        <div
          className={cn(
            "hidden md:flex transition-[width] duration-200 ease-in-out",
            sidebarOpen ? "w-64" : "w-0",
          )}
        >
          {sidebarOpen && (
            <DashboardSidebar onToggleSidebar={toggleSidebar} />
          )}
        </div>

        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={closeMobile}
            />
            <div className="fixed inset-y-0 left-0 z-50 w-64 md:hidden">
              <DashboardSidebar
                onNavigate={closeMobile}
                onToggleSidebar={closeMobile}
              />
            </div>
          </>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!isChat && (
            <div className="flex items-center gap-2 px-3 pt-3">
              {!sidebarOpen && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hidden md:flex cursor-pointer"
                  onClick={toggleSidebar}
                  aria-label="Open sidebar"
                >
                  <PanelLeft className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden cursor-pointer"
                onClick={() => setMobileOpen(true)}
                aria-label="Open sidebar"
              >
                <PanelLeft className="size-4" />
              </Button>
            </div>
          )}
          <div className="h-full min-h-0 min-w-0 overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </SidebarContext>
  );
}
