import PQueue from "p-queue";

let _queue: PQueue | null = null;

export function getQueue(): PQueue {
  if (_queue) return _queue;

  const concurrency = parseInt(process.env.AGENT_CONCURRENCY ?? "2", 10);
  _queue = new PQueue({ concurrency });

  _queue.on("error", (err) => {
    console.error("Job queue error:", err);
  });

  console.log(`Job queue initialized (concurrency: ${concurrency})`);
  return _queue;
}
