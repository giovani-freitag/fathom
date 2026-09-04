/** A worker constructor for a test, which never starts anything. */
export default class MonacoWorker {
    postMessage(): void { /* nothing is listening */ }
    terminate(): void { /* nothing to stop */ }
}
