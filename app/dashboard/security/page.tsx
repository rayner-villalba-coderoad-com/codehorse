"use client";

import { SecurityScanList } from "@/module/security/components/security-scan-list";

export default function SecurityPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Security</h1>
        <p className="text-muted-foreground">
          Scan your synced repositories for security vulnerabilities with an AI agent.
        </p>
      </div>
      <SecurityScanList />
    </div>
  );
}
