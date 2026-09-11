"use client";

import { CopilotPanel } from "@/components/copilot";
import { Panel } from "@/components/ui";

/** Global AI assistant — answers across every case you can access,
 *  or scoped to one case via ?case=<id> (used by case workspaces). */
export default function CopilotPage({ searchParams }: { searchParams?: { case?: string } }) {
  const caseId = searchParams?.case;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">AI Copilot</h1>
        <p className="mt-1 text-sm text-[#8B93A1]">
          {caseId ? (
            <>Scoped to <a className="font-mono text-[#3B82F6] hover:underline" href={`/cases/${caseId}`}>case {caseId}</a> — answers cite that case&apos;s source evidence.</>
          ) : (
            <>Ask across all cases you can access. Answers cite their source evidence — hidden cases never leak.</>
          )}
        </p>
      </div>
      <Panel>
        <CopilotPanel caseId={caseId} />
      </Panel>
    </div>
  );
}
