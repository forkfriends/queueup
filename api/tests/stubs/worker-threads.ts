export const parentPort = null;
export const isMainThread = true;
export const workerData = undefined;
export function postMessage(): void {
  throw new Error("worker_threads not supported in this environment");
}
export function threadId(): number {
  return 0;
}
export default {};
