export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(concurrency, 1), values.length) },
      async () => {
        while (nextIndex < values.length) {
          const index = nextIndex++
          results[index] = await mapper(values[index]!)
        }
      },
    ),
  )
  return results
}
