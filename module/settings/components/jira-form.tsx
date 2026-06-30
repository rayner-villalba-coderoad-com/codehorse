'use client';
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJiraConfig, saveJiraConfig, testJiraConnection } from "@/module/settings/actions";

import { toast } from 'sonner';

export function JiraForm() {
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");

  const { data: config, isLoading } = useQuery({
    queryKey: ["jira-config"],
    queryFn: async () => await getJiraConfig(),
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false
  });

  const hasToken = Boolean(config?.hasToken);

  useEffect(() => {
    if (config) {
      setBaseUrl(config.baseUrl || "");
      setEmail(config.email || "");
      // Token is write-only; never populated from the server.
      setApiToken("");
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async (data: { baseUrl: string; email: string; apiToken?: string }) => {
      return await saveJiraConfig(data);
    },
    onSuccess: (result) => {
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: ["jira-config"] });
        setApiToken("");
        toast.success("Jira configuration saved");
      } else {
        toast.error(result?.error || "Failed to save Jira configuration");
      }
    },
    onError: () => toast.error("Failed to save Jira configuration")
  });

  const testMutation = useMutation({
    mutationFn: async (data: { baseUrl: string; email: string; apiToken?: string }) => {
      return await testJiraConnection(data);
    },
    onSuccess: (result) => {
      if (result?.ok) {
        toast.success("Connected to Jira successfully");
      } else {
        toast.error(result?.error || "Could not connect to Jira");
      }
    },
    onError: () => toast.error("Could not connect to Jira")
  });

  const isBusy = saveMutation.isPending || testMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ baseUrl, email, apiToken });
  };

  const handleTest = () => {
    testMutation.mutate({ baseUrl, email, apiToken });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Jira Integration</CardTitle>
          <CardDescription>Connect Jira so reviews are validated against your tickets</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-muted rounded"></div>
            <div className="h-10 bg-muted rounded"></div>
            <div className="h-10 bg-muted rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jira Integration</CardTitle>
        <CardDescription>
          Add your Jira Cloud credentials so pull request reviews can be validated against the
          linked ticket. Create an API token at id.atlassian.com under Security.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="jira-base-url">Base URL</Label>
            <Input
              id="jira-base-url"
              placeholder="https://your-domain.atlassian.net"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={isBusy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jira-email">Email</Label>
            <Input
              id="jira-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isBusy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jira-api-token">API Token</Label>
            <Input
              id="jira-api-token"
              type="password"
              autoComplete="off"
              placeholder={hasToken ? "•••••••• (configured — leave blank to keep)" : "Paste your Jira API token"}
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              disabled={isBusy}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isBusy}>
              {saveMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
            <Button type="button" variant="outline" onClick={handleTest} disabled={isBusy}>
              {testMutation.isPending ? "Testing..." : "Test connection"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
