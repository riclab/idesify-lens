import { AuditReportView } from "@/components/report/audit-report-view";

export default async function AuditReportPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <AuditReportView sessionId={sessionId} />;
}
