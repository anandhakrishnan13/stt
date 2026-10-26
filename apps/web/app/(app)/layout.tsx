import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { SessionProvider } from "@/lib/session";
import { ToastProvider } from "@/components/ui/toast";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <WorkspaceShell>{children}</WorkspaceShell>
      </ToastProvider>
    </SessionProvider>
  );
}
