"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Clock, CheckCircle2, XCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getReviews } from "@/module/review/actions";
import { formatDistanceToNow } from "date-fns";
import type { Finding, ReviewFindings, Severity } from "@/module/ai/agents/schema";

const CATEGORY_ORDER = [
  { key: "bestPractices", label: "Best Practices" },
  { key: "security", label: "Security" },
  { key: "performance", label: "Performance" },
  { key: "documentation", label: "Documentation" },
  { key: "testing", label: "Testing & Requirements" },
] as const;

function severityVariant(severity: Severity): "default" | "destructive" | "secondary" {
  if (severity === "critical" || severity === "high") return "destructive";
  if (severity === "medium") return "default";
  return "secondary";
}

function FindingsView({ findings }: { findings: ReviewFindings }) {
  return (
    <div className="space-y-4">
      {CATEGORY_ORDER.map(({ key, label }) => {
        const section = findings[key];
        if (!section) return null;
        const items = section.findings ?? [];
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold">{label}</h4>
              <Badge variant="outline">{items.length}</Badge>
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">No issues found.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((finding: Finding, i: number) => (
                  <li key={i} className="rounded-md border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={severityVariant(finding.severity)}>
                        {finding.severity}
                      </Badge>
                      <span className="font-medium">{finding.title}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {finding.description}
                    </p>
                    {finding.suggestion && (
                      <p className="mt-1 text-xs">
                        <span className="font-medium">Suggestion:</span>{" "}
                        {finding.suggestion}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}


export default function ReviewsPage() {
  const {data: reviews, isLoading } = useQuery({
    queryKey: ["reviews"],
    queryFn: async () => {
      return await getReviews()
    }
  });

  if (isLoading) {
    return <div>Loading reviews...</div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Review History</h1>
        <p className="text-muted-foreground">View all AI code reviews</p>
      </div>
      {
        reviews?.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <p className="text-muted-foreground">No reviews yet. Connect a repository and open a PR to get reviewed it.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {
              reviews?.map((review: any) => (
                <Card key={review.id} className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">{review.prTitle}</CardTitle>
                          {review.status === "completed" && (
                            <Badge variant="default" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Completed
                            </Badge>
                          )}
                          {review.status === "failed" && (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="h-3 w-3"/>
                              Failed
                            </Badge>
                          )}
                          {review.status === "pending" && (
                            <Badge variant="secondary" className="gap-1">
                              <Clock className="h-3 w-3"/>
                              Pending
                            </Badge>
                          )}
                        </div>
                        <CardDescription>
                          {review.repository.fullName} - PR #{review.prNumber}
                        </CardDescription>
                        {review.jiraKey && (
                          <a
                            href={review.jiraUrl ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex"
                          >
                            <Badge variant="outline" className="gap-1">
                              <ExternalLink className="h-3 w-3" />
                              {review.jiraKey}
                            </Badge>
                          </a>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" asChild>
                        <a href={review.prUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4"/>
                        </a>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(review.createdAt), { addSuffix: true })}
                      </div>
                      {review.findings ? (
                        <FindingsView findings={review.findings as ReviewFindings} />
                      ) : (
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <div className="bg-muted p-4 rounded-lg">
                            <pre className="whitespace-pre-wrap text-xs">{review.review.substring(0, 300)}...</pre>
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" asChild>
                          <a href={review.prUrl} target="_blank" rel="noopener noreferrer">
                            View Full Review on Github
                          </a>
                        </Button>
                        {review.fixPrUrl && (
                          <Button variant="secondary" asChild>
                            <a href={review.fixPrUrl} target="_blank" rel="noopener noreferrer">
                              View Auto-fix PR
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            }
          </div>
        )
      }
    </div>
  )
}