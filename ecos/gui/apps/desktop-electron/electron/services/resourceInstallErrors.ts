export class ResourceMetadataRestoreError extends AggregateError {
  constructor(errors: Iterable<unknown>, message: string) {
    super(errors, message)
    this.name = 'ResourceMetadataRestoreError'
  }
}
