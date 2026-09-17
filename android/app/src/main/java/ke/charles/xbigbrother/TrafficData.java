package ke.charles.xbigbrother;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

final class TrafficData {
    static final long DAY_MILLIS = 86_400_000L;

    private TrafficData() {}

    static final class Window {
        final long start;
        final long end;
        final String date;

        Window(long start, long end) {
            this.start = start;
            this.end = end;
            this.date = format(start, "yyyy-MM-dd");
        }
    }

    static List<Window> windows(int days, long now) {
        if (days != 7 && days != 30) {
            throw new IllegalArgumentException("days must be 7 or 30");
        }
        long today = Math.floorDiv(now, DAY_MILLIS) * DAY_MILLIS;
        List<Window> result = new ArrayList<>();
        for (int offset = days - 1; offset >= 0; offset--) {
            long start = today - offset * DAY_MILLIS;
            result.add(new Window(start, Math.min(start + DAY_MILLIS, now)));
        }
        return result;
    }

    static String format(long timestamp, String pattern) {
        SimpleDateFormat formatter = new SimpleDateFormat(pattern, Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date(timestamp));
    }

    static void addBytes(Map<Integer, Long> totals, int uid, long rx, long tx) {
        if (rx < 0 || tx < 0) {
            throw new IllegalArgumentException("Android returned invalid traffic counters");
        }
        totals.put(uid, Math.addExact(totals.getOrDefault(uid, 0L), Math.addExact(rx, tx)));
    }

    static void updateAvailability(
        Set<String> unavailableNetworks, Map<Integer, Long> wifi, Map<Integer, Long> mobile
    ) {
        if (wifi == null) {
            unavailableNetworks.add("wifi");
        }
        if (mobile == null) {
            unavailableNetworks.add("mobile");
        }
    }

    static long[] countersForDay(int uid, Map<Integer, Long> wifi, Map<Integer, Long> mobile) {
        // The numeric bridge fields cannot encode unknown. Consumers must ignore a
        // transport for the entire snapshot when it appears in unavailableNetworks;
        // its zero placeholders and any partial counters are not measured totals.
        return new long[] {
            wifi == null ? 0 : wifi.getOrDefault(uid, 0L),
            mobile == null ? 0 : mobile.getOrDefault(uid, 0L)
        };
    }
}
