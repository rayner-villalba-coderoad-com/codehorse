
import prisma from "@/lib/db";
import { inngest } from "../client";
import { getRepoFileContents } from "@/module/github/lib/github";
import { indexCodebase } from "@/module/ai/lib/rag";


export const indexRepo = inngest.createFunction(
  { id: "index-repo",
    triggers: [{event: "repository.connected"}]  
  },
  async ({ event, step }: any) => {
    const { owner, repo, userId } = event.data;

    // Fetch the files we have
    const files = await step.run("fetch-files", async () => {
      const account = await prisma.account.findFirst({
        where: {
          userId: userId,
          providerId: "github",
        },
      });

      if (!account?.accessToken) {
        throw new Error("No Github access token found");
      }

      return await getRepoFileContents(account.accessToken, owner, repo);
    });

    await step.run("index-codebase", async () => {
       await indexCodebase(`${owner}/${repo}`, files)
    });

    return {success: true, indexedFiles: files.length}
  }
);