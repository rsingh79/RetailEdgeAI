-- AlterTable
ALTER TABLE "GmailIntegration" ADD COLUMN     "googleClientId" TEXT,
ADD COLUMN     "googleClientSecretEnc" TEXT,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "accessTokenEnc" DROP NOT NULL,
ALTER COLUMN "refreshTokenEnc" DROP NOT NULL;
