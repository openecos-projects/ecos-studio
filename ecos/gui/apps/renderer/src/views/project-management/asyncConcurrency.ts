export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: values.length }, () => undefined as R)
  let nextIndex = 0
  const workers = Array.from(
    {
      length: Math.min(Math.max(concurrency, 1), values.length),
    },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(values[index]!)
      }
    },
  )
  await Promise.all(workers)
  return results
}
