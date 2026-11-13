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
        TrafficData.addBytes(totals, 10001, 10, 20);
        TrafficData.addBytes(totals, 10001, 3, 4);
        TrafficData.addBytes(totals, 10002, 50, 60);
        assertArrayEquals(new long[] {13, 24}, totals.get(10001));
        assertArrayEquals(new long[] {50, 60}, totals.get(10002));
    }

    @Test
    public void unavailableTransportPreservesOtherTransportWithFlaggedPlaceholder() {
        Map<Integer, long[]> wifi = new HashMap<>();
        TrafficData.addBytes(wifi, 10001, 20, 3);
        // {Wi-Fi received + sent, mobile received + sent, Wi-Fi sent, mobile sent}
        assertArrayEquals(new long[] {23, 0, 3, 0}, TrafficData.countersForDay(10001, wifi, null));
        assertArrayEquals(new long[] {0, 23, 0, 3}, TrafficData.countersForDay(10001, null, wifi));
        assertArrayEquals(new long[] {0, 0, 0, 0}, TrafficData.countersForDay(10001, null, null));
        assertArrayEquals(new long[] {23, 0, 3, 0}, TrafficData.countersForDay(10001, wifi, new HashMap<>()));
        assertArrayEquals(new long[] {0, 0, 0, 0}, TrafficData.countersForDay(10002, wifi, new HashMap<>()));
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsNegativeCounters() {
        TrafficData.addBytes(new HashMap<>(), 10001, -1, 0);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsNegativeSentCounters() {
        TrafficData.addBytes(new HashMap<>(), 10001, 0, -1);
    }

    @Test(expected = ArithmeticException.class)
    public void rejectsOverflowRatherThanReturningNegativeUsage() {
        TrafficData.addBytes(new HashMap<>(), 10001, Long.MAX_VALUE, 1);
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
