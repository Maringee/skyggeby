-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "senderDeletedAt" TIMESTAMP(3),
    "recipientDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_recipientId_createdAt_idx" ON "messages"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_senderId_createdAt_idx" ON "messages"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_recipientId_readAt_idx" ON "messages"("recipientId", "readAt");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The server trims and validates before it writes, but the database refuses a
-- message that is empty, whitespace-only or absurdly long no matter which code
-- path produced it.
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_subject_length"
  CHECK (char_length(btrim("subject")) BETWEEN 1 AND 100);

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_content_length"
  CHECK (char_length(btrim("content")) BETWEEN 1 AND 5000);

-- Writing to yourself is not a message, and the rule belongs where it cannot
-- be bypassed.
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_not_self"
  CHECK ("senderId" <> "recipientId");
