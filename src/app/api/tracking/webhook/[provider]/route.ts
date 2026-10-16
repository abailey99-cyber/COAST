import { receiveAggregatorWebhook } from "@/server/aggregator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Tracking updates from the aggregator, signed by it (readiness Task 4). */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  return receiveAggregatorWebhook(request, provider);
}
