import { createElement as e } from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

export interface DashboardReportMetric {
    label: string;
    value: string;
    deltaPct?: number;
    trend?: 'up' | 'down' | 'flat';
}

export interface DashboardReportSection {
    title: string;
    /** Optional context line under the title, e.g. the period date range. */
    subtitle?: string;
    metrics: DashboardReportMetric[];
}

export interface DashboardReportListItem {
    name: string;
    value: string;
}

export interface DashboardReportData {
    /** e.g. "June 2026" */
    monthLabel: string;
    /** ISO timestamp the report was generated. */
    generatedAt: string;
    sections: DashboardReportSection[];
    topCategories: DashboardReportListItem[];
    paymentMix: DashboardReportListItem[];
}

const styles = StyleSheet.create({
    page: {
        paddingTop: 40,
        paddingBottom: 48,
        paddingHorizontal: 44,
        fontSize: 11,
        color: '#1a1a1a',
        fontFamily: 'Helvetica',
    },
    header: {
        marginBottom: 24,
        borderBottomWidth: 2,
        borderBottomColor: '#111111',
        paddingBottom: 12,
    },
    brand: {
        fontSize: 10,
        letterSpacing: 2,
        color: '#6b7280',
        fontFamily: 'Helvetica-Bold',
        marginBottom: 6,
    },
    title: {
        fontSize: 22,
        fontFamily: 'Helvetica-Bold',
    },
    subtitle: {
        fontSize: 10,
        color: '#6b7280',
        marginTop: 4,
    },
    section: {
        marginBottom: 20,
    },
    sectionTitle: {
        fontSize: 13,
        fontFamily: 'Helvetica-Bold',
        marginBottom: 10,
    },
    sectionTitleTight: {
        marginBottom: 2,
    },
    sectionSubtitle: {
        fontSize: 9,
        color: '#6b7280',
        marginBottom: 10,
    },
    metricRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    metricCard: {
        width: '33.33%',
        paddingRight: 12,
        marginBottom: 12,
    },
    metricLabel: {
        fontSize: 9,
        color: '#6b7280',
        marginBottom: 3,
    },
    metricValue: {
        fontSize: 16,
        fontFamily: 'Helvetica-Bold',
    },
    metricDelta: {
        fontSize: 9,
        marginTop: 2,
    },
    deltaUp: { color: '#15803d' },
    deltaDown: { color: '#b91c1c' },
    deltaFlat: { color: '#6b7280' },
    listRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 5,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    listName: { fontSize: 10 },
    listValue: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
    emptyText: { fontSize: 10, color: '#9ca3af' },
    footer: {
        position: 'absolute',
        bottom: 24,
        left: 44,
        right: 44,
        fontSize: 8,
        color: '#9ca3af',
        textAlign: 'center',
    },
});

function deltaStyle(trend?: 'up' | 'down' | 'flat') {
    if (trend === 'up') return styles.deltaUp;
    if (trend === 'down') return styles.deltaDown;
    return styles.deltaFlat;
}

function formatDelta(metric: DashboardReportMetric): string | null {
    if (metric.deltaPct === undefined) return null;
    // Direction is conveyed by the +/- sign and the colour (deltaStyle); avoid
    // arrow glyphs since the core Helvetica font has no triangle characters.
    const sign = metric.deltaPct > 0 ? '+' : '';
    return `${sign}${metric.deltaPct.toFixed(1)}% vs prev period`;
}

const generatedAtFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
});

function formatGeneratedAt(iso: string): string {
    return `${generatedAtFormatter.format(new Date(iso))} UTC`;
}

function renderMetric(metric: DashboardReportMetric, key: number) {
    const delta = formatDelta(metric);
    return e(
        View,
        { key, style: styles.metricCard },
        e(Text, { style: styles.metricLabel }, metric.label),
        e(Text, { style: styles.metricValue }, metric.value),
        delta
            ? e(
                  Text,
                  { style: [styles.metricDelta, deltaStyle(metric.trend)] },
                  delta
              )
            : null
    );
}

function renderSection(section: DashboardReportSection, key: number) {
    return e(
        View,
        { key, style: styles.section },
        e(
            Text,
            {
                style: section.subtitle
                    ? [styles.sectionTitle, styles.sectionTitleTight]
                    : styles.sectionTitle,
            },
            section.title
        ),
        section.subtitle
            ? e(Text, { style: styles.sectionSubtitle }, section.subtitle)
            : null,
        e(
            View,
            { style: styles.metricRow },
            ...section.metrics.map((m, i) => renderMetric(m, i))
        )
    );
}

function renderList(
    title: string,
    items: DashboardReportListItem[],
    key: number
) {
    return e(
        View,
        { key, style: styles.section },
        e(Text, { style: styles.sectionTitle }, title),
        items.length === 0
            ? e(Text, { style: styles.emptyText }, 'No data for this period.')
            : items.map((item, i) =>
                  e(
                      View,
                      { key: i, style: styles.listRow },
                      e(Text, { style: styles.listName }, item.name),
                      e(Text, { style: styles.listValue }, item.value)
                  )
              )
    );
}

/**
 * Builds the dashboard monthly report PDF element tree. Uses React.createElement
 * directly so the backend needs no JSX/TSX compiler configuration.
 */
export function DashboardReportDocument(data: DashboardReportData) {
    return e(
        Document,
        { title: `Dashboard report — ${data.monthLabel}` },
        e(
            Page,
            { size: 'A4', style: styles.page },
            e(
                View,
                { style: styles.header },
                e(Text, { style: styles.brand }, 'JINX.TO — STORE REPORT'),
                e(Text, { style: styles.title }, data.monthLabel),
                e(
                    Text,
                    { style: styles.subtitle },
                    `Generated ${formatGeneratedAt(data.generatedAt)}`
                )
            ),
            ...data.sections.map((s, i) => renderSection(s, i)),
            renderList('Top categories', data.topCategories, 9001),
            renderList('Payment mix', data.paymentMix, 9002),
            e(
                Text,
                {
                    style: styles.footer,
                    render: ({
                        pageNumber,
                        totalPages,
                    }: {
                        pageNumber: number;
                        totalPages: number;
                    }) =>
                        `jinx.to confidential · page ${pageNumber} of ${totalPages}`,
                    fixed: true,
                },
                ''
            )
        )
    );
}
