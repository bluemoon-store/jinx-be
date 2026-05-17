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

export function resolvePeriod(
    period: PeriodKey,
    now: Date = new Date()
): PeriodRange {
    const to = new Date(now);
    let from: Date;
    let bucket: BucketUnit;

    switch (period) {
        case PeriodKey.TWENTY_FOUR_HOURS:
            from = new Date(to.getTime() - 24 * MS_PER_HOUR);
            bucket = 'hour';
            break;
        case PeriodKey.SEVEN_DAYS:
            from = new Date(to.getTime() - 7 * MS_PER_DAY);
            bucket = 'day';
            break;
        case PeriodKey.THIRTY_DAYS:
            from = new Date(to.getTime() - 30 * MS_PER_DAY);
            bucket = 'day';
            break;
        case PeriodKey.THREE_MONTHS:
            from = subtractUtcMonths(to, 3);
            bucket = 'week';
            break;
        case PeriodKey.TWELVE_MONTHS:
        default:
            from = subtractUtcMonths(to, 12);
            bucket = 'month';
            break;
    }

    const durationMs = to.getTime() - from.getTime();
    const prevTo = new Date(from);
    const prevFrom = new Date(from.getTime() - durationMs);

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

/** Last N UTC weeks ending at `now` (exclusive end = now). */
export function resolveSparklineWeeks(
    weekCount: number,
    now: Date = new Date()
): { from: Date; to: Date } {
    const to = new Date(now);
    const from = new Date(to.getTime() - weekCount * 7 * MS_PER_DAY);
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

function subtractUtcMonths(date: Date, months: number): Date {
    return new Date(
        Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth() - months,
            date.getUTCDate(),
            date.getUTCHours(),
            date.getUTCMinutes(),
            date.getUTCSeconds(),
            date.getUTCMilliseconds()
        )
    );
}
