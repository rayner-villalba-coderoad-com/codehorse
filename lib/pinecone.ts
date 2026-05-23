import {Pinecone} from "@pinecone-database/pinecone";

export const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_DB_API_KEY!
})

// The name of index must be equal of pinecone index 
export const pineconeIndex = pinecone.index({name: "codehorse-vector-embeddings-v1"});