// Week boundaries, in one place.
//
// Nightwatch writes its intelligence onto a week's brief row and the BI
// Reporter reads it back, so both must agree on which Monday a given moment
// belongs to. Everything here works in UTC — a local-time version would put a
// client in a different week depending on where the server ran.

/** The Monday of the week containing `date`, at 00:00:00 UTC. */
export function getMonday(date: Date = new Date()): Date {
  const d = new Date(date)
  const day = d.getUTCDay() // 0 = Sunday .. 6 = Saturday
  const diff = (day === 0 ? -6 : 1) - day // days back to Monday
  d.setUTCDate(d.getUTCDate() + diff)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/** The same Monday as a `YYYY-MM-DD` string, which is what week_start stores. */
export function getMondayDateString(date: Date = new Date()): string {
  return getMonday(date).toISOString().slice(0, 10)
}
