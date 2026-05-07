"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Ellipsis, PanelLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/anonymous-session";
import { cn } from "@/lib/utils";

interface SessionListItem {
  id: string;
  title: string | null;
  updatedAt: string;
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("es-CL");
}

export function DashboardSidebar({
  onNavigate,
  onToggleSidebar,
  className,
}: {
  onNavigate?: () => void;
  onToggleSidebar?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sessionItems, setSessionItems] = useState<SessionListItem[]>([]);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await apiFetch("/api/managed-agents/sessions");
      if (!res.ok) return;
      const data: { sessions?: SessionListItem[] } = await res.json();
      setSessionItems(data.sessions ?? []);
    } catch {
      // best effort
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void refreshSessions(), 0);
    const interval = setInterval(() => void refreshSessions(), 5_000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [refreshSessions]);

  const deleteSession = useCallback(
    async (chatId: string) => {
      try {
        const res = await apiFetch(
          `/api/managed-agents/session?sessionId=${encodeURIComponent(chatId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) return;
        setSessionItems((prev) => prev.filter((s) => s.id !== chatId));
        if (pathname === `/chat/${chatId}`) {
          router.push("/");
        }
      } catch {
        // best effort
      }
    },
    [pathname, router],
  );

  const selectedSessionId = pathname.startsWith("/chat/")
    ? pathname.split("/")[2] ?? null
    : null;

  return (
    <aside
      className={cn(
        "flex h-full w-64 shrink-0 flex-col gap-3 p-3",
        className,
      )}
    >
      <div className="flex items-center justify-between px-1">
        <Link
          href="/"
          onClick={onNavigate}
          aria-label="Idesify Lens — inicio"
          className="flex items-center gap-2"
        >
          <span className="brand-dot" />
          <span
            className="text-[16px] font-medium tracking-tight"
            style={{ letterSpacing: "-0.01em" }}
          >
            Lens
          </span>
        </Link>
        {onToggleSidebar && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Cerrar barra lateral"
            onClick={onToggleSidebar}
            className="cursor-pointer"
          >
            <PanelLeft className="size-4" />
          </Button>
        )}
      </div>

      <Link
        href="/"
        onClick={onNavigate}
        className="flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-[13.5px] transition-colors"
        style={{
          background: "var(--card)",
          borderColor: "var(--border)",
          color: "var(--ink-2)",
        }}
      >
        <Plus className="size-4" />
        <span>Nueva auditoría</span>
      </Link>

      <div
        className="lens-panel flex min-h-0 flex-1 flex-col"
        style={{ borderRadius: 18 }}
      >
        <div className="lens-panel-head" style={{ padding: "12px 16px" }}>
          <span className="ttl">Auditorías recientes</span>
          {sessionItems.length > 0 && (
            <span
              className="font-mono text-[11px]"
              style={{ color: "var(--muted-2)" }}
            >
              {sessionItems.length}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {sessionItems.length === 0 && (
            <div
              className="px-2 py-3 text-[12.5px]"
              style={{ color: "var(--muted-2)" }}
            >
              Aún no hay auditorías.
            </div>
          )}
          {sessionItems.map((session) => {
            const active = selectedSessionId === session.id;
            return (
              <div
                key={session.id}
                className={cn("group/session relative")}
              >
                <Link
                  href={`/chat/${session.id}`}
                  onClick={onNavigate}
                  className="lens-step block pr-8"
                  style={{
                    background: active ? "var(--secondary)" : "transparent",
                    color: active ? "var(--foreground)" : "var(--ink-2)",
                  }}
                >
                  <span
                    className="ic"
                    aria-hidden
                    style={{
                      background: active ? "var(--accent-deep)" : "var(--card)",
                      border: active
                        ? "none"
                        : "1px solid var(--border)",
                    }}
                  />
                  <span className="t truncate">
                    {session.title || "Auditoría sin título"}
                  </span>
                  <span
                    className="ms"
                    suppressHydrationWarning
                  >
                    {formatTimeAgo(session.updatedAt)}
                  </span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="absolute right-1 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1 opacity-0 transition-opacity hover:bg-secondary group-hover/session:opacity-100 data-[popup-open]:opacity-100"
                    aria-label="Opciones de sesión"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Ellipsis className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="bottom">
                    <DropdownMenuItem
                      className="cursor-pointer"
                      style={{ color: "var(--red)" }}
                      onClick={() => void deleteSession(session.id)}
                    >
                      <Trash2 className="size-4" />
                      Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
