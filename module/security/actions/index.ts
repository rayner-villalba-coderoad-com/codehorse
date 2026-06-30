"use server";
import prisma from "@/lib/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { inngest } from "@/inngest/client";

/**
 * Lists the user's connected repositories, each with its most recent security
 * scan (if any), for the Security dashboard.
 */
export async function getRepositoriesWithLatestScan() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const repositories = await prisma.repository.findMany({
    where: {
      userId: session.user.id,
    },
    include: {
      securityScans: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return repositories;
}

/**
 * Kicks off a whole-repo security scan: creates a pending SecurityScan row and
 * emits the Inngest event that runs the scan in the background.
 */
export async function requestSecurityScan(repositoryId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const repository = await prisma.repository.findUnique({
    where: {
      id: repositoryId,
      userId: session.user.id,
    },
  });

  if (!repository) {
    throw new Error("Repository not found");
  }

  const scan = await prisma.securityScan.create({
    data: {
      repositoryId: repository.id,
      status: "pending",
    },
  });

  await inngest.send({
    name: "repository.security_scan.requested",
    data: {
      scanId: scan.id,
      repositoryId: repository.id,
      owner: repository.owner,
      repo: repository.name,
      userId: session.user.id,
    },
  });

  return scan;
}
