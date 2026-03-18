-- AlterTable
ALTER TABLE "GmailIntegration" ADD COLUMN     "connectionType" TEXT NOT NULL DEFAULT 'oauth',
ADD COLUMN     "imapEmail" TEXT,
ADD COLUMN     "imapHost" TEXT,
ADD COLUMN     "imapLastUid" INTEGER DEFAULT 0,
ADD COLUMN     "imapPasswordEnc" TEXT,
ADD COLUMN     "imapPort" INTEGER DEFAULT 993,
ADD COLUMN     "imapUseSsl" BOOLEAN NOT NULL DEFAULT true;
