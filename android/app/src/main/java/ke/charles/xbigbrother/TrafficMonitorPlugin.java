package ke.charles.xbigbrother;

import android.app.AppOpsManager;
import android.app.usage.NetworkStats;
import android.app.usage.NetworkStatsManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.PermissionInfo;
import android.content.pm.ResolveInfo;
import android.net.ConnectivityManager;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import android.text.TextUtils;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "TrafficMonitor")
public class TrafficMonitorPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean reading = new AtomicBoolean();

    @PluginMethod
    public void getSnapshot(PluginCall call) {
        Object requested = call.getData().opt("days");
        if (!(requested instanceof Number)
            || (((Number) requested).doubleValue() != 7 && ((Number) requested).doubleValue() != 30)) {
            call.reject("days must be 7 or 30", "INVALID_DAYS");
            return;
        }
        int days = ((Number) requested).intValue();
        if (!reading.compareAndSet(false, true)) {
            call.reject("A snapshot is already being read. Please try again.", "BUSY");
            return;
        }
        try {
            worker.execute(() -> {
                try {
                    call.resolve(snapshot(days));
                } catch (Exception error) {
                    call.reject("Unable to read the Android app inventory.", "SNAPSHOT_FAILED", error);
                } finally {
                    reading.set(false);
                }
            });
        } catch (RejectedExecutionException error) {
            reading.set(false);
            call.reject("The app is closing.", "UNAVAILABLE");
        }
    }

    private JSObject snapshot(int days) {
        long now = System.currentTimeMillis();
        Set<String> warnings = new LinkedHashSet<>();
        Set<String> unavailableNetworks = new LinkedHashSet<>();
        warnings.add("Totals cover only visible launcher-app UIDs in this Android profile, not all device traffic. "
            + "Hidden apps, other profiles, removed apps and system traffic are excluded or unknown.");
        warnings.add("Days and query intervals use UTC; today is partial. Android counters can lag, "
            + "be rounded to reporting buckets, or be unavailable. No live packet capture is performed.");
        warnings.add("Permissions are Android's declared permission grant flags, not evidence of use. "
            + "App-ops, special access and one-time restrictions may differ; review Android Settings.");
        Map<Integer, AppGroup> groups = inventory(warnings);
        boolean access = hasUsageAccess();
        if (!access) {
            unavailableNetworks.add("wifi");
            unavailableNetworks.add("mobile");
            warnings.add("Usage access is not granted. Apps and permissions remain visible; "
                + "traffic is unknown until you grant this app Usage access in Android Settings.");
        } else {
            NetworkStatsManager manager = getContext().getSystemService(NetworkStatsManager.class);
            if (manager == null) {
                unavailableNetworks.add("wifi");
                unavailableNetworks.add("mobile");
                warnings.add("Android network statistics are unavailable. Traffic is unknown, not zero.");
            } else {
                for (TrafficData.Window window : TrafficData.windows(days, now)) {
                    if (Thread.currentThread().isInterrupted()) {
                        throw new IllegalStateException("Snapshot cancelled");
                    }
                    Map<Integer, Long> wifi = queryTransport(manager, ConnectivityManager.TYPE_WIFI, window, warnings);
                    Map<Integer, Long> mobile;
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                        // Android 10+ supports a null subscriber ID for aggregate mobile queries.
                        // On older releases we refuse to request phone identifiers/READ_PHONE_STATE.
                        mobile = null;
                        warnings.add("Mobile usage is unavailable on Android 7–9 without phone identifiers, "
                            + "which this app does not request. Mobile totals are unknown, not zero.");
                    } else {
                        mobile = queryTransport(manager, ConnectivityManager.TYPE_MOBILE, window, warnings);
                    }
                    // Any failed day invalidates this transport's totals for the entire snapshot.
                    // The other transport remains usable, including on Android 7–9.
                    TrafficData.updateAvailability(unavailableNetworks, wifi, mobile);
                    for (AppGroup group : groups.values()) {
                        long[] bytes = TrafficData.countersForDay(group.uid, wifi, mobile);
                        JSObject day = new JSObject();
                        day.put("date", window.date);
                        day.put("wifi", bytes[0]);
                        day.put("mobile", bytes[1]);
                        group.days.put(day);
                    }
                }
            }
            // Access can be revoked while the background queries are in progress.
            access = hasUsageAccess();
            if (!access) {
                unavailableNetworks.add("wifi");
                unavailableNetworks.add("mobile");
                for (AppGroup group : groups.values()) {
                    group.days = new JSArray();
                }
                warnings.add("Usage access was revoked during the query. Traffic has been cleared.");
            }
        }
        List<AppGroup> sorted = new ArrayList<>(groups.values());
        sorted.sort(Comparator.comparing(AppGroup::name, String.CASE_INSENSITIVE_ORDER)
            .thenComparingInt(group -> group.uid));
        JSArray apps = new JSArray();
        for (AppGroup group : sorted) {
            apps.put(group.toJson());
        }
        JSObject result = new JSObject();
        result.put("accessGranted", access);
        result.put("generatedAt", TrafficData.format(now, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"));
        result.put("apps", apps);
        result.put("warnings", new JSArray(new ArrayList<>(warnings)));
        result.put("unavailableNetworks", new JSArray(new ArrayList<>(unavailableNetworks)));
        return result;
    }

    @SuppressWarnings("deprecation")
    private Set<String> launcherPackages() {
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        Set<String> packages = new java.util.TreeSet<>();
        // Query the launcher intent, not all installed packages. Android package visibility
        // is deliberately limited by the matching <queries> entry in the manifest.
        for (ResolveInfo info : getContext().getPackageManager().queryIntentActivities(launcher, 0)) {
            if (info.activityInfo != null) {
                packages.add(info.activityInfo.packageName);
            }
        }
        return packages;
    }

    @SuppressWarnings("deprecation")
    private Map<Integer, AppGroup> inventory(Set<String> warnings) {
        PackageManager pm = getContext().getPackageManager();
        Map<Integer, AppGroup> groups = new TreeMap<>();
        for (String packageName : launcherPackages()) {
            try {
                PackageInfo info = pm.getPackageInfo(packageName, PackageManager.GET_PERMISSIONS);
                ApplicationInfo app = info.applicationInfo;
                if (app == null) {
                    continue;
                }
                AppGroup group = groups.computeIfAbsent(app.uid, AppGroup::new);
                group.packages.add(packageName);
                group.labels.add(pm.getApplicationLabel(app).toString());
                if (info.requestedPermissions == null) {
                    continue;
                }
                for (int i = 0; i < info.requestedPermissions.length; i++) {
                    String id = info.requestedPermissions[i];
                    boolean granted = info.requestedPermissionsFlags != null
                        && i < info.requestedPermissionsFlags.length
                        && (info.requestedPermissionsFlags[i] & PackageInfo.REQUESTED_PERMISSION_GRANTED) != 0;
                    JSObject permission = group.permissions.get(id);
                    if (permission == null) {
                        permission = new JSObject();
                        permission.put("id", id);
                        String label = id;
                        try {
                            PermissionInfo permissionInfo = pm.getPermissionInfo(id, 0);
                            label = permissionInfo.loadLabel(pm).toString();
                        } catch (PackageManager.NameNotFoundException ignored) {
                            // An unavailable custom permission has no system label; retain its real ID.
                        }
                        permission.put("label", label);
                        permission.put("granted", granted);
                        group.permissions.put(id, permission);
                    } else if (granted) {
                        permission.put("granted", true);
                    }
                }
            } catch (PackageManager.NameNotFoundException | SecurityException error) {
                warnings.add("An app changed or became inaccessible while reading the inventory. Refresh to retry.");
            }
        }
        // NetworkStats identifies UIDs, not packages. Shared-UID packages must be grouped
        // once to avoid duplicate bytes; invisible UID siblings cannot be separated.
        warnings.add("Shared UIDs are counted once. Their traffic cannot be split between packages "
            + "and may include hidden UID siblings. Group permissions are combined across visible packages.");
        return groups;
    }

    @SuppressWarnings("deprecation")
    private Map<Integer, Long> queryTransport(
        NetworkStatsManager manager, int transport, TrafficData.Window window, Set<String> warnings
    ) {
        String label = transport == ConnectivityManager.TYPE_WIFI ? "Wi-Fi" : "Mobile";
        // Summary buckets contain per-UID totals. One query per transport/day (at most
        // 60 calls) avoids a separate expensive Binder query for every visible app.
        try (NetworkStats stats = manager.querySummary(transport, null, window.start, window.end)) {
            if (stats == null) {
                warnings.add(label + " statistics are unavailable. This network's totals are unknown, not zero.");
                return null;
            }
            Map<Integer, Long> totals = new HashMap<>();
            NetworkStats.Bucket bucket = new NetworkStats.Bucket();
            while (stats.hasNextBucket()) {
                if (!stats.getNextBucket(bucket)) {
                    throw new IllegalStateException("Incomplete Android statistics");
                }
                TrafficData.addBytes(totals, bucket.getUid(), bucket.getRxBytes(), bucket.getTxBytes());
            }
            return totals;
        } catch (SecurityException error) {
            warnings.add(label + " statistics were denied by Android. This network's totals are unknown, not zero.");
            return null;
        } catch (Exception error) {
            warnings.add(label + " statistics could not be read. This network's totals are unknown, not zero.");
            return null;
        }
    }

    @SuppressWarnings("deprecation")
    private boolean hasUsageAccess() {
        AppOpsManager ops = getContext().getSystemService(AppOpsManager.class);
        if (ops == null) {
            return false;
        }
        try {
            return ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(), getContext().getPackageName()) == AppOpsManager.MODE_ALLOWED;
        } catch (SecurityException error) {
            return false;
        }
    }

    @PluginMethod
    public void openUsageSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        openSettings(call, intent, new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        String packageName = call.getString("packageName");
        try {
            if (packageName == null || !launcherPackages().contains(packageName)) {
                call.reject("Choose a currently installed visible app.", "INVALID_PACKAGE");
                return;
            }
            getContext().getPackageManager().getApplicationInfo(packageName, 0);
        } catch (PackageManager.NameNotFoundException | SecurityException error) {
            call.reject("This app is no longer accessible.", "INVALID_PACKAGE");
            return;
        }
        // Android alone can revoke another app's permissions, with the user's action.
        openSettings(call, new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", packageName, null)), null);
    }

    private void openSettings(PluginCall call, Intent intent, Intent fallback) {
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(intent);
                call.resolve();
            } catch (ActivityNotFoundException | SecurityException error) {
                if (fallback != null) {
                    try {
                        getActivity().startActivity(fallback);
                        call.resolve();
                        return;
                    } catch (ActivityNotFoundException | SecurityException ignored) {
                        // Some device vendors do not expose a usage-access Settings screen.
                    }
                }
                call.reject("Android Settings could not be opened on this device.", "SETTINGS_UNAVAILABLE");
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        worker.shutdownNow();
    }

    private static final class AppGroup {
        final int uid;
        final List<String> packages = new ArrayList<>();
        final List<String> labels = new ArrayList<>();
        final Map<String, JSObject> permissions = new TreeMap<>();
        JSArray days = new JSArray();

        AppGroup(int uid) {
            this.uid = uid;
        }

        String name() {
            return TextUtils.join(" / ", labels);
        }

        JSObject toJson() {
            JSObject result = new JSObject();
            result.put("id", "uid:" + uid);
            result.put("name", name());
            result.put("packages", new JSArray(packages));
            result.put("days", days);
            result.put("permissions", new JSArray(new ArrayList<>(permissions.values())));
            return result;
        }
    }
}
