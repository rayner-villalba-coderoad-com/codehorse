import { pineconeIndex } from "@/lib/pinecone";
import { embed } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const google = createGoogleGenerativeAI({
  baseURL: "https://generativelanguage.googleapis.com/v1",
});

export async function generateEmbedding(text: string) {
  const {embedding} = await embed({
    model: google.embeddingModel("gemini-embedding-001"),
    value: text
  });

  return embedding;
}

export async function indexCodebase(repoId: string, files: {path: string, content: string}[]) {
  const vectors = [];

  for(const file of files) {
    const content = `File: ${file.path}\n\n${file.content}`;
    const truncatedContent = content.slice(0, 8000);

    try {
      const embedding = await generateEmbedding(truncatedContent);

      vectors.push({
        id: `${repoId}-${file.path.replace(/\//g, '_')}`,
        values: embedding,
        metadata: {
          repoId,
          path: file.path,
          content: truncatedContent
        }
      })
    } catch (error) {
      console.error(`Failed to embed ${file.path}: `, error);
      throw error;
    }
  }

  if (vectors.length > 0) {
    const bathSize = 100;

    for(let i = 0; i<vectors.length;i +=bathSize) {
      const batch = vectors.slice(i, i+bathSize);

      console.log('Batch: ', batch)
      await pineconeIndex.upsert({records: batch})

    }
  }

  console.log("Indexing Complete");
}

export async function retrieveContext(query: string, repoId: string, topK: number=5) {
  const embedding = await generateEmbedding(query);

  const results = await pineconeIndex.query({
    vector: embedding,
    filter:{repoId},
    topK,
    includeMetadata: true
  });

  return results.matches.map(match => match.metadata?.content as string).filter(Boolean);
}