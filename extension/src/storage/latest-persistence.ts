export type LatestPersistenceResult = 'persisted' | 'superseded';

export type LatestPersistenceCoordinator<T> = Readonly<{
  persist(value: T): Promise<LatestPersistenceResult>;
  supersedeWith(value: T): void;
}>;

type PersistenceRequest<T> = {
  readonly sequence: number;
  readonly value: T;
  resolve(result: LatestPersistenceResult): void;
  reject(error: unknown): void;
};

export function createLatestPersistenceCoordinator<T>(
  write: (value: T) => Promise<void>,
): LatestPersistenceCoordinator<T> {
  let sequence = 0;
  let draining = false;
  let pending: PersistenceRequest<T> | null = null;

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (pending) {
        const request = pending;
        pending = null;
        try {
          await write(request.value);
          request.resolve(request.sequence === sequence ? 'persisted' : 'superseded');
        } catch (error) {
          if (request.sequence === sequence) request.reject(error);
          else request.resolve('superseded');
        }
      }
    } finally {
      draining = false;
    }
  }

  function persist(value: T): Promise<LatestPersistenceResult> {
    const requestSequence = ++sequence;
    return new Promise((resolve, reject) => {
      pending?.resolve('superseded');
      pending = { sequence: requestSequence, value, resolve, reject };
      void drain();
    });
  }

  function supersedeWith(value: T): void {
    if (!draining && !pending) return;
    void persist(value).catch(() => undefined);
  }

  return Object.freeze({ persist, supersedeWith });
}
