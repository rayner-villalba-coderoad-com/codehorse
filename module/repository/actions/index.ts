"use server";
import prisma from "@/lib/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { createWebhook, getRepositories } from "@/module/github/lib/github";

export const fetchRepositories = async (page: number = 1, perPage: number = 10) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    throw new Error("Unauthorized");
  }

  const githubRepos = await getRepositories(page, perPage);

  const dbRepose = await prisma.repository.findMany({
    where: {
      userId: session.user.id,
    },
  });

  const connectedRepoIds = new Set(dbRepose.map((repo => repo.githubId)));

  return githubRepos.map((repo: any) => ({
    ...repo,
    isConnected: connectedRepoIds.has(String(repo.id)),
  }));
};

export const connectRepository = async(owner: string, repo: string, githubId: number) => {
  const session = await auth.api.getSession({
    headers: await headers()
  })

  if (!session) {
    throw new Error('Unauthorized')
  }

  await prisma.repository.upsert({
    where: { githubId: String(githubId) },
    create: {
      githubId: String(githubId),
      name: repo,
      owner,
      fullName: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}`,
      userId: session.user.id,
    },
    update: {},
  });

  const webhook = await createWebhook(owner, repo).catch((err) => {
    console.error('Webhook creation failed:', err);
    return null;
  });

  //TODO: INCREMENT REPOSITORY COUNT FOR USAGE TRACKING

  //TODO: TRIGGER REPOSITORY INDEXING FOR RAG

  return webhook;
}