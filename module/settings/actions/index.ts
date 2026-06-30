"use server";
import {auth } from '@/lib/auth';
import { headers } from 'next/headers';
import prisma from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { deleteWebhook } from '@/module/github/lib/github';
import { verifyJiraCredentials } from '@/module/jira/lib/jira';


export async function getUserProfile() {
  try {
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const user = await prisma.user.findUnique({
      where: {
        id: session.user.id
      },
      select: {
        id: true, 
        name: true,
        email: true,
        image: true,
        createdAt: true
      }
    });

    return user;
  } catch (error) {
    console.log("Error fetching user profile:", error)
    return null;
  }
}
export async function updateUserProfile(data: {name?:string; email?: string}) {
  try {
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const updateUser = await prisma.user.update({
      where: {
        id: session.user.id
      },
      data: {
        name: data.name,
        email: data.email
      },
      select: {
        id: true,
        name: true,
        email:true
      }
    });

    revalidatePath("/dashboard/settings", "page");

    return{
      success: true,
      user: updateUser
    }
  } catch (error) {
    console.log("Error updating user profile:", error)
    return { success: false, error: "Failed to update profile"};
  }
}

// Returns the current user's Jira config WITHOUT the API token. The token is
// write-only: the client only learns whether one is set (`hasToken`).
export async function getJiraConfig() {
  try {
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const config = await prisma.jiraConfig.findUnique({
      where: {
        userId: session.user.id
      },
      select: {
        baseUrl: true,
        email: true,
        apiToken: true
      }
    });

    if (!config) {
      return null;
    }

    return {
      baseUrl: config.baseUrl,
      email: config.email,
      hasToken: Boolean(config.apiToken)
    };
  } catch (error) {
    console.log("Error fetching Jira config:", error);
    return null;
  }
}

// Upserts the user's Jira config. A blank apiToken on an existing config keeps
// the stored token (the form leaves the field empty unless the user changes it).
export async function saveJiraConfig(data: { baseUrl: string; email: string; apiToken?: string }) {
  try {
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const baseUrl = data.baseUrl.trim();
    const email = data.email.trim();
    const apiToken = data.apiToken?.trim() ?? "";

    if (!baseUrl || !email) {
      return { success: false, error: "Base URL and email are required." };
    }

    const existing = await prisma.jiraConfig.findUnique({
      where: { userId: session.user.id },
      select: { id: true }
    });

    if (!existing && !apiToken) {
      return { success: false, error: "An API token is required." };
    }

    await prisma.jiraConfig.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        baseUrl,
        email,
        apiToken
      },
      // Only overwrite the token when a new one was provided.
      update: {
        baseUrl,
        email,
        ...(apiToken ? { apiToken } : {})
      }
    });

    revalidatePath("/dashboard/settings", "page");

    return { success: true };
  } catch (error) {
    console.log("Error saving Jira config:", error);
    return { success: false, error: "Failed to save Jira configuration" };
  }
}

// Validates Jira credentials against the live API. A blank apiToken reuses the
// stored token so the user can test without re-entering it.
export async function testJiraConnection(data: { baseUrl: string; email: string; apiToken?: string }) {
  try {
    const session = await auth.api.getSession({
      headers: await headers()
    });

    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const baseUrl = data.baseUrl.trim();
    const email = data.email.trim();
    let apiToken = data.apiToken?.trim() ?? "";

    if (!apiToken) {
      const existing = await prisma.jiraConfig.findUnique({
        where: { userId: session.user.id },
        select: { apiToken: true }
      });
      apiToken = existing?.apiToken ?? "";
    }

    return await verifyJiraCredentials({ baseUrl, email, apiToken });
  } catch (error) {
    console.log("Error testing Jira connection:", error);
    return { ok: false, error: "Failed to test Jira connection" };
  }
}

export async function getConnectedRepositories() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      throw new Error("Unauthorized");
    }

    const repositories = await prisma.repository.findMany({
      where: {
        userId: session.user.id
      }, 
      select: {
        id: true,
        name: true,
        fullName: true,
        url: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return repositories;
  } catch (error) {
    console.error("Error fetching connected repositories: ", error);
    return [];
  }
}

export async function disconnectRepository(repositoryId: string) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      throw new Error("Unauthorized");
    }

    const repository = await prisma.repository.findUnique({
      where: {
        id: repositoryId,
        userId: session.user.id
      }
    });

    if (!repository) {
      throw new Error("Repository not found");
    }

    await deleteWebhook(repository.owner, repository.name);

    await prisma.repository.delete({
      where: {
        id: repositoryId,
        userId: session.user.id
      }
    });

    revalidatePath("/dashboard/settings", "page");
    revalidatePath("/dashboard/repository", "page");

    return { success: true }
  } catch (error) {
    console.error("Error disconnecting repository: ", error);
    return { success: false, error: "Failed to disconnect repository"}
    
  }
}

export async function disconnectAllRepositories() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      throw new Error("Unauthorized");
    }

    const repositories = await prisma.repository.findMany({
      where: {
        userId: session.user.id
      }
    });

    await Promise.all(repositories.map(async(repo) => {
      await deleteWebhook(repo.owner, repo.name)
    }))

    //Delete all repositories 
    const result = await prisma.repository.deleteMany({
      where: {
        userId: session.user.id
      }
    });

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/repository");


    return { success: true, count: result.count }
  } catch (error) {
    console.error("Error disconnecting all repositories: ", error);
    return { success: false, error: "Failed to disconnect repositories"}   
  }
}
