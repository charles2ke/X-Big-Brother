package ke.charles.xbigbrother;

import static org.junit.Assert.*;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import org.junit.Test;

public class TrafficDataTest {
    @Test
    public void windowsAreUtcAndIncludePartialToday() {
        TimeZone previous = TimeZone.getDefault();
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Auckland"));
            long now = 1_726_142_400_000L; // 2024-09-12T12:00:00Z
            List<TrafficData.Window> windows = TrafficData.windows(7, now);
            assertEquals(7, windows.size());
            assertEquals("2024-09-06", windows.get(0).date);
            assertEquals("2024-09-12", windows.get(6).date);
            assertEquals(now, windows.get(6).end);
            assertEquals(TrafficData.DAY_MILLIS / 2, now - windows.get(6).start);
            for (int i = 1; i < windows.size(); i++) {
                assertEquals(windows.get(i - 1).end, windows.get(i).start);
            }
        } finally {
            TimeZone.setDefault(previous);
        }
    }

    @Test
    public void thirtyDayWindowNeverQueriesFuture() {
        long now = 1_726_142_400_000L;
        List<TrafficData.Window> windows = TrafficData.windows(30, now);
        assertEquals(30, windows.size());
        for (TrafficData.Window window : windows) {
            assertTrue(window.end <= now);
            assertTrue(window.start >= now - 30 * TrafficData.DAY_MILLIS);
        }
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsUnboundedWindow() {
        TrafficData.windows(365, 1_726_142_400_000L);
    }

    @Test
    public void sumsMultipleBucketsForOneUidPerDirectionWithoutAffectingOtherUids() {
        Map<Integer, long[]> totals = new HashMap<>();
        TrafficData.addBytes(totals, 10001, 10, 20, false);
        TrafficData.addBytes(totals, 10001, 3, 4, false);
        TrafficData.addBytes(totals, 10002, 50, 60, false);
        assertArrayEquals(new long[] {13, 24, 0, 0}, totals.get(10001));
        assertArrayEquals(new long[] {50, 60, 0, 0}, totals.get(10002));
    }

    @Test
    public void backgroundBucketsCountTowardsTotalsAndTheBackgroundShare() {
        Map<Integer, long[]> totals = new HashMap<>();
        TrafficData.addBytes(totals, 10001, 100, 10, false);
        TrafficData.addBytes(totals, 10001, 30, 5, true);
        TrafficData.addBytes(totals, 10001, 2, 1, true);
        // {received, sent, background received, background sent}
        assertArrayEquals(new long[] {132, 16, 32, 6}, totals.get(10001));
    }

    @Test
    public void dayCountersFollowTheBridgeFieldOrder() {
        Map<Integer, long[]> wifi = new HashMap<>();
        Map<Integer, long[]> mobile = new HashMap<>();
        TrafficData.addBytes(wifi, 10001, 100, 10, false);
        TrafficData.addBytes(wifi, 10001, 30, 5, true);
        TrafficData.addBytes(mobile, 10001, 7, 3, true);
        long[] counters = TrafficData.dayCounters(10001, wifi, mobile);
        assertEquals(TrafficData.DAY_FIELDS.length, counters.length);
        // wifi, mobile, wifiSent, mobileSent, wifiBackground, mobileBackground, wifiBackgroundSent, mobileBackgroundSent
        assertArrayEquals(new long[] {145, 10, 15, 3, 35, 10, 5, 3}, counters);
    }

    @Test
    public void unavailableTransportPreservesOtherTransportWithFlaggedPlaceholder() {
        Map<Integer, long[]> wifi = new HashMap<>();
        TrafficData.addBytes(wifi, 10001, 20, 3, true);
        assertArrayEquals(new long[] {23, 0, 3, 0, 23, 0, 3, 0}, TrafficData.dayCounters(10001, wifi, null));
        assertArrayEquals(new long[] {0, 23, 0, 3, 0, 23, 0, 3}, TrafficData.dayCounters(10001, null, wifi));
        assertArrayEquals(new long[] {23, 0, 3, 0, 23, 0, 3, 0}, TrafficData.dayCounters(10001, wifi, new HashMap<>()));
    }

    @Test
    public void daysWithoutTrafficAreOmitted() {
        Map<Integer, long[]> wifi = new HashMap<>();
        TrafficData.addBytes(wifi, 10001, 20, 3, false);
        TrafficData.addBytes(wifi, 10003, 0, 0, true);
        assertNull(TrafficData.dayCounters(10001, null, null));
        assertNull(TrafficData.dayCounters(10002, wifi, new HashMap<>()));
        assertNull(TrafficData.dayCounters(10003, wifi, new HashMap<>()));
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsNegativeCounters() {
        TrafficData.addBytes(new HashMap<>(), 10001, -1, 0, false);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsNegativeSentCounters() {
        TrafficData.addBytes(new HashMap<>(), 10001, 0, -1, true);
    }

    @Test(expected = ArithmeticException.class)
    public void rejectsOverflowRatherThanReturningNegativeUsage() {
        TrafficData.addBytes(new HashMap<>(), 10001, Long.MAX_VALUE, 1, true);
    }

    @Test
    public void anyFailedDayMarksTransportUnavailableForWholeSnapshot() {
        Set<String> unavailable = new HashSet<>();
        Map<Integer, long[]> available = new HashMap<>();
        TrafficData.updateAvailability(unavailable, available, available);
        assertTrue(unavailable.isEmpty());
        TrafficData.updateAvailability(unavailable, available, null);
        TrafficData.updateAvailability(unavailable, available, available);
        assertEquals(1, unavailable.size());
        assertTrue(unavailable.contains("mobile"));
        TrafficData.updateAvailability(unavailable, null, available);
        assertEquals(2, unavailable.size());
        assertTrue(unavailable.contains("wifi"));
    }
}
