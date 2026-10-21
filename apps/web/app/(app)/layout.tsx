import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { SessionProvider } from "@/lib/session";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
    </SessionProvider>
  );
}
