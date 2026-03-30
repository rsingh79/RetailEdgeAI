import { PrismaClient } from '../src/generated/prisma/client.js';
import * as readline from 'readline';

const prisma = new PrismaClient();

// ─── Helper: ask for confirmation ───────────────
function confirm(question) {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(question + ' (yes/no): ', answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function run() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PIPELINE IMPORT RESET SCRIPT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ─── STEP 1: Show what will be deleted ──────────

  const importJobs = await prisma.importJob.findMany({
    select: {
      id:           true,
      tenantId:     true,
      sourceName:   true,
      status:       true,
      rowsCreated:  true,
      rowsPendingApproval: true,
      createdAt:    true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (importJobs.length === 0) {
    console.log('No ImportJob records found. Nothing to delete.');
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log(`ImportJobs found: ${importJobs.length}`);
  for (const job of importJobs) {
    console.log(
      `  [${job.id}] ${job.sourceName || 'unnamed'}` +
      ` | status: ${job.status}` +
      ` | created: ${job.rowsCreated}` +
      ` | pending: ${job.rowsPendingApproval}` +
      ` | date: ${job.createdAt.toISOString().split('T')[0]}`
    );
  }

  const importJobIds = importJobs.map(j => j.id);
  const tenantIds    = [...new Set(importJobs.map(j => j.tenantId))];

  const approvalQueueCount =
    await prisma.approvalQueueEntry.count({
      where: { importJobId: { in: importJobIds } },
    });

  const importRecordCount =
    await prisma.productImportRecord.count({
      where: { importJobId: { in: importJobIds } },
    });

  const auditLogCount = await prisma.auditLog.count({
    where: { importJobId: { in: importJobIds } },
  });

  const pipelineProductCount = await prisma.product.count({
    where: { importId: { in: importJobIds } },
  });

  const sourceNames = [
    ...new Set(
      importJobs
        .map(j => j.sourceName)
        .filter(Boolean)
    ),
  ];

  const bulkApprovedCount = await prisma.product.count({
    where: {
      approvalStatus: 'APPROVED',
      source: sourceNames.length > 0
        ? { in: sourceNames }
        : undefined,
      importId: null,
    },
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('RECORDS THAT WILL BE DELETED:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ApprovalQueueEntry:   ${approvalQueueCount}`);
  console.log(`  ProductImportRecord:  ${importRecordCount}`);
  console.log(`  AuditLog (pipeline):  ${auditLogCount}`);
  console.log(`  ImportJob:            ${importJobIds.length}`);
  console.log(`  Products (importId):  ${pipelineProductCount}`);
  console.log(`  Products (bulk):      ${bulkApprovedCount}`);
  console.log(`  TOTAL PRODUCTS:       ${pipelineProductCount + bulkApprovedCount}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ─── STEP 2: Confirm ────────────────────────────

  const ok = await confirm(
    'Are you sure you want to delete all of the above?'
  );

  if (!ok) {
    console.log('Aborted. Nothing was deleted.');
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log('\nDeleting in order...\n');

  // ─── STEP 3: Delete in FK-safe order ────────────

  const deletedQueue =
    await prisma.approvalQueueEntry.deleteMany({
      where: { importJobId: { in: importJobIds } },
    });
  console.log(`✓ Deleted ApprovalQueueEntry: ${deletedQueue.count}`);

  const deletedImportRecords =
    await prisma.productImportRecord.deleteMany({
      where: { importJobId: { in: importJobIds } },
    });
  console.log(`✓ Deleted ProductImportRecord: ${deletedImportRecords.count}`);

  const deletedAuditLogs = await prisma.auditLog.deleteMany({
    where: { importJobId: { in: importJobIds } },
  });
  console.log(`✓ Deleted AuditLog entries: ${deletedAuditLogs.count}`);

  const deletedPipelineProducts =
    await prisma.product.deleteMany({
      where: { importId: { in: importJobIds } },
    });
  console.log(`✓ Deleted Products (importId): ${deletedPipelineProducts.count}`);

  let deletedBulkProducts = { count: 0 };
  if (sourceNames.length > 0) {
    deletedBulkProducts = await prisma.product.deleteMany({
      where: {
        approvalStatus: 'APPROVED',
        source:         { in: sourceNames },
        importId:       null,
      },
    });
    console.log(`✓ Deleted Products (bulk approved): ${deletedBulkProducts.count}`);
  }

  const deletedJobs = await prisma.importJob.deleteMany({
    where: { id: { in: importJobIds } },
  });
  console.log(`✓ Deleted ImportJob: ${deletedJobs.count}`);

  // ─── STEP 4: Verify ─────────────────────────────

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('VERIFICATION:');

  const remainingJobs      = await prisma.importJob.count();
  const remainingQueue     = await prisma.approvalQueueEntry.count();
  const remainingRecords   = await prisma.productImportRecord.count();
  const remainingProducts  = await prisma.product.count();

  console.log(`  ImportJob remaining:           ${remainingJobs}`);
  console.log(`  ApprovalQueueEntry remaining:  ${remainingQueue}`);
  console.log(`  ProductImportRecord remaining: ${remainingRecords}`);
  console.log(`  Products remaining in catalog: ${remainingProducts}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const totalDeleted =
    deletedQueue.count +
    deletedImportRecords.count +
    deletedAuditLogs.count +
    deletedPipelineProducts.count +
    deletedBulkProducts.count +
    deletedJobs.count;

  console.log(`Reset complete. Total records deleted: ${totalDeleted}`);
  console.log('You can now re-run a fresh import to test pipeline behaviour.');

  await prisma.$disconnect();
}

run().catch(err => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
