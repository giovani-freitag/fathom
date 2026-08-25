/** Receives every published state. A listener reacts; it does not transform. */
export type StoreListener<TState> = (state: TState) => void;

/** Cancels a subscription. Calling it twice is safe. */
export type Unsubscribe = () => void;

export interface ObservableStoreConfig<TState> {
    readonly initialState: TState;
}

/**
 * The core's only state primitive: a value plus a subscription list.
 *
 * `read` must return the same reference until the state actually changes. It is
 * fed straight into `useSyncExternalStore`, where a snapshot rebuilt on every
 * read re-renders forever.
 */
export class ObservableStore<TState> {
    private state: TState;
    private readonly listeners = new Set<StoreListener<TState>>();

    constructor(config: ObservableStoreConfig<TState>) {
        this.state = config.initialState;
    }

    /**
     * The current state, by reference.
     *
     * @returns The state; never mutate what comes out of here.
     */
    read(): TState {
        return this.state;
    }

    /**
     * Registers a listener.
     *
     * The listener is not called on subscribe: the caller already has the state
     * from `read`, and an immediate call would make every consumer render twice.
     *
     * @param listener - Called with each published state.
     * @returns The canceller for this listener.
     */
    subscribe(listener: StoreListener<TState>): Unsubscribe {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Replaces the state and notifies every listener.
     *
     * @param next - The new state; a value identical by reference publishes nothing.
     */
    write(next: TState): void {
        if (next === this.state) {
            return;
        }
        this.state = next;
        for (const listener of this.listeners) {
            listener(this.state);
        }
    }

    /**
     * Derives the next state from the current one.
     *
     * @param produce - Receives the current state and returns the next; must not mutate its argument.
     */
    update(produce: (current: TState) => TState): void {
        this.write(produce(this.state));
    }

    get listenerCount(): number {
        return this.listeners.size;
    }
}
