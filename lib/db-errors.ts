// Postgres error code for a column or table the code expects but the
// database doesn't have yet — i.e. a migration hasn't been applied.
const SCHEMA_OUT_OF_DATE = new Set(["42703", "42P01"]); // undefined_column, undefined_table

export function isSchemaOutOfDate(err: any): boolean {
  return SCHEMA_OUT_OF_DATE.has(err?.code) || SCHEMA_OUT_OF_DATE.has(err?.cause?.code);
}

/** A user-facing message for an error, with a fix for the most common one. */
export function describeError(err: any, fallback = "Something went wrong."): string {
  if (isSchemaOutOfDate(err)) {
    return "The database schema is out of date. Run `npm run db:migrate`, then try again.";
  }
  return err?.message ?? fallback;
}
