import {
    PeriodKey,
    resolvePeriod,
    resolveRange,
    resolveSparklineWeeks,
    resolveSummaryDeltaWindow,
    resolveTodayYesterday,
    startOfUtcDay,
} from 'src/modules/dashboard/utils/period.util';

describe('dashboard period util', () => {
    const fixedNow = new Date('2026-05-17T15:30:00.000Z');

    it('resolvePeriod maps 24hours to hour buckets', () => {
        const range = resolvePeriod(PeriodKey.TWENTY_FOUR_HOURS, fixedNow);
        expect(range.bucket).toBe('hour');
        expect(range.to.getTime()).toBe(fixedNow.getTime());
        expect(range.from.getTime()).toBe(
            fixedNow.getTime() - 24 * 60 * 60 * 1000
        );
        expect(range.prevTo.getTime()).toBe(range.from.getTime());
    });

    it('resolvePeriod maps 12months to month buckets', () => {
        const range = resolvePeriod(PeriodKey.TWELVE_MONTHS, fixedNow);
        expect(range.bucket).toBe('month');
        expect(range.from.getUTCFullYear()).toBe(2025);
        expect(range.from.getUTCMonth()).toBe(4);
    });

    it('resolveRange picks bucket by span', () => {
        const short = resolveRange(
            new Date('2026-05-17T00:00:00.000Z'),
            new Date('2026-05-17T12:00:00.000Z')
        );
        expect(short.bucket).toBe('hour');

        const medium = resolveRange(
            new Date('2026-05-01T00:00:00.000Z'),
            new Date('2026-05-10T00:00:00.000Z')
        );
        expect(medium.bucket).toBe('day');

        const long = resolveRange(
            new Date('2026-03-01T00:00:00.000Z'),
            new Date('2026-05-01T00:00:00.000Z')
        );
        expect(long.bucket).toBe('week');

        const veryLong = resolveRange(
            new Date('2025-01-01T00:00:00.000Z'),
            new Date('2026-05-01T00:00:00.000Z')
        );
        expect(veryLong.bucket).toBe('month');
    });

    it('resolveTodayYesterday returns UTC day boundaries', () => {
        const { todayStart, tomorrowStart, yesterdayStart } =
            resolveTodayYesterday(fixedNow);
        expect(todayStart.toISOString()).toBe('2026-05-17T00:00:00.000Z');
        expect(tomorrowStart.toISOString()).toBe('2026-05-18T00:00:00.000Z');
        expect(yesterdayStart.toISOString()).toBe('2026-05-16T00:00:00.000Z');
    });

    it('resolveSummaryDeltaWindow uses 30-day windows', () => {
        const window = resolveSummaryDeltaWindow(fixedNow);
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        expect(window.currentTo.getTime()).toBe(fixedNow.getTime());
        expect(window.currentFrom.getTime()).toBe(
            fixedNow.getTime() - thirtyDaysMs
        );
        expect(window.previousTo.getTime()).toBe(window.currentFrom.getTime());
        expect(window.previousFrom.getTime()).toBe(
            window.currentFrom.getTime() - thirtyDaysMs
        );
    });

    it('resolveSparklineWeeks spans 8 weeks', () => {
        const { from, to } = resolveSparklineWeeks(8, fixedNow);
        expect(to.getTime()).toBe(fixedNow.getTime());
        expect(from.getTime()).toBe(
            fixedNow.getTime() - 8 * 7 * 24 * 60 * 60 * 1000
        );
    });

    it('startOfUtcDay truncates to UTC midnight', () => {
        expect(startOfUtcDay(fixedNow).toISOString()).toBe(
            '2026-05-17T00:00:00.000Z'
        );
    });
});
