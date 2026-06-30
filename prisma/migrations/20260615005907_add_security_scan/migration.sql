-- CreateTable
CREATE TABLE "security_scan" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "report" TEXT,
    "findings" JSONB,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "highCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "fixBranch" TEXT,
    "fixPrUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_scan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_scan_repositoryId_idx" ON "security_scan"("repositoryId");

-- AddForeignKey
ALTER TABLE "security_scan" ADD CONSTRAINT "security_scan_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
