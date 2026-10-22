-- CreateTable
CREATE TABLE "live_practice_voices" (
    "userId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_practice_voices_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "live_practice_voices" ADD CONSTRAINT "live_practice_voices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

