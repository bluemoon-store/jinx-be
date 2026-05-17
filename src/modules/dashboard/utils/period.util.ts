export enum PeriodKey {
    TWELVE_MONTHS = '12months',
    THREE_MONTHS = '3months',
    THIRTY_DAYS = '30days',
    SEVEN_DAYS = '7days',
    TWENTY_FOUR_HOURS = '24hours',
}

export type BucketUnit = 'hour' | 'day' | 'week' | 'month';

export type PeriodRange = {
    from: Date;
    to: Date;
    prevFrom: Date;
    prevTo: Date;
    bucket: BucketUnit;
};

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const PERIOD_BUCKET_COUNT: Record<
    PeriodKey,
    { bucket: BucketUnit; count: number }
> = {
    [PeriodKey.TWENTY_FOUR_HOURS]: { bucket: 'hour', count: 24 },
    [PeriodKey.SEVEN_DAYS]: { bucket: 'day', count: 7 },
    [PeriodKey.THIRTY_DAYS]: { bucket: 'day', count: 30 },
    [PeriodKey.THREE_MONTHS]: { bucket: 'week', count: 13 },
    [PeriodKey.TWELVE_MONTHS]: { bucket: 'month', count: 12 },
};

export function resolvePeriod(
    period: PeriodKey,
    now: Date = new Date()
): PeriodRange {
    const { bucket, count } = PERIOD_BUCKET_COUNT[period];
    // `to` = start of the next whole bucket after `now`. `from` = `to` minus N
    // whole buckets. Every bucket in [from, to) is complete, so date_trunc
    // labels never produce partial first/last buckets.
    const to = addBuckets(truncToBucket(now, bucket), bucket, 1);
    const from = addBuckets(to, bucket, -count);
    const prevTo = from;
    const prevFrom = addBuckets(prevTo, bucket, -count);
    return { from, to, prevFrom, prevTo, bucket };
}

export function resolveRange(from: Date, to: Date): { bucket: BucketUnit } {
    const spanMs = to.getTime() - from.getTime();
    if (spanMs <= 2 * MS_PER_DAY) {
        return { bucket: 'hour' };
    }
    if (spanMs <= 14 * MS_PER_DAY) {
        return { bucket: 'day' };
    }
    if (spanMs <= 90 * MS_PER_DAY) {
        return { bucket: 'week' };
    }
    return { bucket: 'month' };
}

/** UTC start of calendar day containing `date`. */
export function startOfUtcDay(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

/** UTC start of today and yesterday for today-stats. */
export function resolveTodayYesterday(now: Date = new Date()): {
    todayStart: Date;
    tomorrowStart: Date;
    yesterdayStart: Date;
} {
    const todayStart = startOfUtcDay(now);
    const tomorrowStart = new Date(
        Date.UTC(
            todayStart.getUTCFullYear(),
            todayStart.getUTCMonth(),
            todayStart.getUTCDate() + 1
        )
    );
    const yesterdayStart = new Date(
        Date.UTC(
            todayStart.getUTCFullYear(),
            todayStart.getUTCMonth(),
            todayStart.getUTCDate() - 1
        )
    );
    return { todayStart, tomorrowStart, yesterdayStart };
}

/**
 * Last N full ISO weeks ending at the most recent Monday on/before `now`.
 * Boundaries are ISO Monday-aligned so they match postgres `date_trunc('week', ...)`.
 */
export function resolveSparklineWeeks(
    weekCount: number,
    now: Date = new Date()
): { from: Date; to: Date } {
    const to = truncToBucket(now, 'week');
    const from = addBuckets(to, 'week', -weekCount);
    return { from, to };
}

/** Fixed 30-day window ending at `now` for summary KPI deltas. */
export function resolveSummaryDeltaWindow(now: Date = new Date()): {
    currentFrom: Date;
    currentTo: Date;
    previousFrom: Date;
    previousTo: Date;
} {
    const currentTo = new Date(now);
    const currentFrom = new Date(currentTo.getTime() - 30 * MS_PER_DAY);
    const previousTo = new Date(currentFrom);
    const previousFrom = new Date(previousTo.getTime() - 30 * MS_PER_DAY);
    return { currentFrom, currentTo, previousFrom, previousTo };
}

/**
 * Snap a Date down to the start of its containing bucket in UTC. Matches
 * postgres `date_trunc(unit, ...)`:
 *  - hour: zero minutes/seconds/ms
 *  - day:  UTC midnight
 *  - week: ISO Monday (UTC midnight)
 *  - month: 1st of month (UTC midnight)
 */
export function truncToBucket(date: Date, bucket: BucketUnit): Date {
    const d = new Date(date);
    switch (bucket) {
        case 'hour':
            d.setUTCMinutes(0, 0, 0);
            return d;
        case 'day':
            d.setUTCHours(0, 0, 0, 0);
            return d;
        case 'week': {
            d.setUTCHours(0, 0, 0, 0);
            const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
            const offsetFromMonday = (day + 6) % 7;
            d.setUTCDate(d.getUTCDate() - offsetFromMonday);
            return d;
        }
        case 'month':
            return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    }
}

/** Add N (possibly negative) whole buckets to `date` in UTC. */
export function addBuckets(date: Date, bucket: BucketUnit, n: number): Date {
    const d = new Date(date);
    switch (bucket) {
        case 'hour':
            d.setUTCHours(d.getUTCHours() + n);
            return d;
        case 'day':
            d.setUTCDate(d.getUTCDate() + n);
            return d;
        case 'week':
            d.setUTCDate(d.getUTCDate() + n * 7);
            return d;
        case 'month':
            return new Date(
                Date.UTC(
                    d.getUTCFullYear(),
                    d.getUTCMonth() + n,
                    d.getUTCDate(),
                    d.getUTCHours(),
                    d.getUTCMinutes(),
                    d.getUTCSeconds(),
                    d.getUTCMilliseconds()
                )
            );
    }
}

/**
 * Enumerate every bucket-start in `[from, to)` for the given unit. The first
 * entry is `truncToBucket(from, bucket)` — i.e. the bucket that contains `from`,
 * even when `from` itself is mid-bucket.
 */
export function enumerateBuckets(
    from: Date,
    to: Date,
    bucket: BucketUnit
): Date[] {
    const result: Date[] = [];
    let cursor = truncToBucket(from, bucket);
    while (cursor.getTime() < to.getTime()) {
        result.push(new Date(cursor));
        cursor = addBuckets(cursor, bucket, 1);
    }
    return result;
}

/**
 * Fill missing buckets so the response has one row per enumerated bucket-start.
 * Rows whose `bucket` timestamp lines up with an enumerated start are kept;
 * gaps are filled via `makeEmpty(bucketStart)`.
 */
export function densifyBuckets<R extends { bucket: Date }>(
    rows: R[],
    bucketStarts: Date[],
    makeEmpty: (bucket: Date) => R
): R[] {
    const byMs = new Map<number, R>(
        rows.map(row => [row.bucket.getTime(), row])
    );
    return bucketStarts.map(
        start => byMs.get(start.getTime()) ?? makeEmpty(start)
    );
}
