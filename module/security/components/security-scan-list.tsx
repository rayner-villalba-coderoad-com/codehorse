"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
  ScanLine,
  Clock,
  XCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getRepositoriesWithLatestScan, requestSecurityScan } from "@/module/security/actions";
import type { Finding, Severity } from "@/module/ai/agents/schema";

function severityVariant(severity: Severity): "default" | "destructive" | "secondary" {
  if (severity === "critical" || severity === "high") return "destructive";
  if (severity === "medium") return "default";
  return "secondary";
}

type ScanStatus = "pending" | "running" | "completed" | "failed";

interface LatestScan {
  id: string;
  status: ScanStatus;
  findings: unknown;
  criticalCount: number;
  highCount: number;
  totalCount: number;
  fixPrUrl: string | null;
  error: string | null;
  createdAt: string | Date;
}

interface RepoWithScan {
  id: string;
  name: string;
  fullName: string;
  url: string;
  securityScans: LatestScan[];
}

function StatusBadge({ status }: { status: ScanStatus }) {
  if (status === "completed") {
    return (
      <Badge variant="default" className="gap-1">
        <ShieldCheck className="h-3 w-3" />
        Completed
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        Failed
      </Badge>
    );
  }
  // pending | running
  return (
    <Badge variant="secondary" className="gap-1">
      <Clock className="h-3 w-3" />
      {status === "running" ? "Scanning…" : "Queued"}
    </Badge>
  );
}

function FindingsView({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <p className="text-sm text-muted-foreground">No security issues found. ✅</p>;
  }

  return (
    <ul className="space-y-2">
      {findings.map((finding, i) => (
        <li key={i} className="rounded-md border p-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={severityVariant(finding.severity)}>{finding.severity}</Badge>
            <span className="font-medium">{finding.title}</span>
            {finding.file && (
              <span className="text-xs text-muted-foreground">· {finding.file}</span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{finding.description}</p>
          {finding.suggestion && (
            <p className="mt-1 text-xs">
              <span className="font-medium">Suggestion:</span> {finding.suggestion}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SecurityScanList() {
  const queryClient = useQueryClient();

  const { data: repositories, isLoading } = useQuery({
    queryKey: ["security-scans"],
    queryFn: async () => (await getRepositoriesWithLatestScan()) as unknown as RepoWithScan[],
    // Poll while any scan is still in flight so the UI updates as it completes.
    refetchInterval: (query) => {
      const repos = query.state.data as RepoWithScan[] | undefined;
      const active = repos?.some((r) => {
        const s = r.securityScans[0]?.status;
        return s === "pending" || s === "running";
      });
      return active ? 4000 : false;
    },
  });

  const scanMutation = useMutation({
    mutationFn: async (repositoryId: string) => await requestSecurityScan(repositoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["security-scans"] });
    },
  });

  if (isLoading) {
    return <div>Loading repositories...</div>;
  }

  if (!repositories || repositories.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              No connected repositories yet. Connect a repository to scan it for vulnerabilities.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {repositories.map((repo) => {
        const scan = repo.securityScans[0];
        const isScanning = scan?.status === "pending" || scan?.status === "running";
        const isPending = scanMutation.isPending && scanMutation.variables === repo.id;
        const findings = (scan?.findings as Finding[] | null) ?? [];

        return (
          <Card key={repo.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg">{repo.fullName}</CardTitle>
                    {scan && <StatusBadge status={scan.status} />}
                  </div>
                  {scan?.status === "completed" && (
                    <CardDescription className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1">
                        {scan.criticalCount > 0 ? (
                          <ShieldAlert className="h-3 w-3 text-destructive" />
                        ) : (
                          <ShieldCheck className="h-3 w-3" />
                        )}
                        {scan.totalCount} findings
                      </span>
                      <span>· 🔴 {scan.criticalCount} critical</span>
                      <span>· 🟠 {scan.highCount} high</span>
                      <span>· {formatDistanceToNow(new Date(scan.createdAt), { addSuffix: true })}</span>
                    </CardDescription>
                  )}
                  {scan?.status === "failed" && (
                    <CardDescription className="text-destructive">
                      {scan.error ?? "Scan failed"}
                    </CardDescription>
                  )}
                </div>
                <Button
                  onClick={() => scanMutation.mutate(repo.id)}
                  disabled={isScanning || isPending}
                  className="gap-2"
                >
                  {isScanning || isPending ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <ScanLine className="h-4 w-4" />
                  )}
                  {scan ? "Re-scan" : "Scan"}
                </Button>
              </div>
            </CardHeader>
            {scan?.status === "completed" && (
              <CardContent>
                <div className="space-y-4">
                  <FindingsView findings={findings} />
                  {scan.fixPrUrl && (
                    <div>
                      <Button variant="secondary" asChild>
                        <a href={scan.fixPrUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4" />
                          View Fix PR
                        </a>
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
