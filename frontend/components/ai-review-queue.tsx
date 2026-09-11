"use client";

/** Cross-case tab helper: pending AI review counts with a deep link into
 *  the Entities tab where confirmations happen. Read-only here. */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Panel, EmptyState, Icon } from "@/components/ui";

export function AiReviewQueue({ caseId, onReview }: { caseId: string; onReview: () => void }) {
  const [counts, setCounts] = useState<{ e: number; r: number; m: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [e, r, m] = await Promise.all([
        api.reviewEntities(caseId),
        api.reviewRelations(caseId),
        api.reviewMerges(caseId),
      ]);
      setCounts({ e: (e as unknown[]).length, r: (r as unknown[]).length, m: (m as unknown[]).length });
    } catch {
      setCounts(null);
    }
  }, [caseId]);

  useEffect(() => { refresh(); }, [refresh]);

  const total = counts ? counts.e + counts.r + counts.m : 0;

  return (
    <Panel title="AI review queue" count={counts ? total : "…"}>
      {!counts ? (
        <EmptyState icon="spark" title="Queue unreachable" hint="The review service didn't answer — retry from the Entities tab." />
      ) : total === 0 ? (
        <EmptyState icon="check" title="Queue clear" hint="Every AI suggestion for this case has been decided." />
      ) : (
        <div>
          <ul className="space-y-1.5 text-sm">
            <li className="flex justify-between"><span>{counts.e} entities awaiting confirm</span></li>
            <li className="flex justify-between"><span>{counts.r} relationships awaiting confirm</span></li>
            <li className="flex justify-between"><span>{counts.m} merge suggestions awaiting decision</span></li>
          </ul>
          <button onClick={onReview} className="btn mt-3 w-full !py-1.5 text-xs">
            Review in Entities tab <Icon name="arrowR" className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </Panel>
  );
}
