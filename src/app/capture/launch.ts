/**
 * Keep CaptureScreen unmounted until every deferred delete is durable. Its
 * first effects immediately read memo continuation and command candidates, so
 * mounting first creates a real read-before-delete race.
 */
export async function afterPendingDeletes(flush: () => Promise<void>, mount: () => void): Promise<void> {
  await flush();
  mount();
}
