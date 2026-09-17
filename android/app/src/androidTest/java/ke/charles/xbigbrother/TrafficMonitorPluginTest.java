package ke.charles.xbigbrother;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class TrafficMonitorPluginTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final TrafficMonitorPlugin plugin = new TrafficMonitorPlugin() {
        @Override
        public Context getContext() {
            return context;
        }
    };

    @After
    public void tearDown() {
        plugin.handleOnDestroy();
    }

    @Test
    public void snapshotIncludesRealLabelsAndPermissionsEvenWithoutUsageAccess() throws Exception {
        JSObject options = new JSObject();
        options.put("days", 7);
        ResultCall call = new ResultCall("getSnapshot", options);
        plugin.getSnapshot(call);
        assertTrue("Snapshot did not finish", call.finished.await(90, TimeUnit.SECONDS));
        assertNull(call.error);
        assertNotNull(call.result);
        assertTrue(call.result.getString("generatedAt").endsWith("Z"));
        assertTrue(call.result.getJSONArray("warnings").length() > 0);
        JSONArray unavailable = call.result.getJSONArray("unavailableNetworks");
        Set<String> unavailableNames = new HashSet<>();
        for (int i = 0; i < unavailable.length(); i++) {
            String network = unavailable.getString(i);
            assertTrue(network.equals("wifi") || network.equals("mobile"));
            assertTrue(unavailableNames.add(network));
        }
        if (!call.result.getBoolean("accessGranted")) {
            assertEquals(2, unavailableNames.size());
        }
        JSONArray apps = call.result.getJSONArray("apps");
        Set<String> ids = new HashSet<>();
        boolean foundSelf = false;
        String ownLabel = context.getPackageManager().getApplicationLabel(context.getApplicationInfo()).toString();
        for (int i = 0; i < apps.length(); i++) {
            JSONObject app = apps.getJSONObject(i);
            assertTrue("Shared UIDs must appear only once", ids.add(app.getString("id")));
            if (!call.result.getBoolean("accessGranted")) {
                assertEquals(0, app.getJSONArray("days").length());
            }
            JSONArray packages = app.getJSONArray("packages");
            for (int p = 0; p < packages.length(); p++) {
                if (context.getPackageName().equals(packages.getString(p))) {
                    foundSelf = true;
                    assertTrue(app.getString("name").contains(ownLabel));
                    JSONArray permissions = app.getJSONArray("permissions");
                    boolean foundUsagePermission = false;
                    for (int j = 0; j < permissions.length(); j++) {
                        JSONObject permission = permissions.getJSONObject(j);
                        if ("android.permission.PACKAGE_USAGE_STATS".equals(permission.getString("id"))) {
                            foundUsagePermission = true;
                            assertFalse(permission.getString("label").isEmpty());
                        }
                    }
                    assertTrue(foundUsagePermission);
                }
            }
        }
        assertTrue("Launcher inventory must contain this installed app", foundSelf);
    }

    @Test
    public void rejectsInvalidWindowAndUntrustedPackageName() throws Exception {
        JSObject options = new JSObject();
        options.put("days", 365);
        ResultCall windowCall = new ResultCall("getSnapshot", options);
        plugin.getSnapshot(windowCall);
        assertEquals("INVALID_DAYS", windowCall.error);

        options = new JSObject();
        options.put("packageName", "package:com.android.settings/../../");
        ResultCall packageCall = new ResultCall("openAppSettings", options);
        plugin.openAppSettings(packageCall);
        assertEquals("INVALID_PACKAGE", packageCall.error);
    }

    @Test
    public void manifestDoesNotRequestNetworkOrPhonePrivilegesOrAllowBackup() throws Exception {
        PackageInfo info = context.getPackageManager().getPackageInfo(
            context.getPackageName(), PackageManager.GET_PERMISSIONS);
        Set<String> permissions = new HashSet<>();
        if (info.requestedPermissions != null) {
            java.util.Collections.addAll(permissions, info.requestedPermissions);
        }
        assertTrue(permissions.contains("android.permission.PACKAGE_USAGE_STATS"));
        assertFalse(permissions.contains("android.permission.INTERNET"));
        assertFalse(permissions.contains("android.permission.READ_PHONE_STATE"));
        assertFalse(permissions.contains("android.permission.QUERY_ALL_PACKAGES"));
        assertEquals(0, context.getApplicationInfo().flags & ApplicationInfo.FLAG_ALLOW_BACKUP);
        assertEquals(0, context.getApplicationInfo().flags & ApplicationInfo.FLAG_USES_CLEARTEXT_TRAFFIC);
    }

    private static final class ResultCall extends PluginCall {
        final CountDownLatch finished = new CountDownLatch(1);
        JSObject result;
        String error;

        ResultCall(String method, JSObject data) {
            super(null, "TrafficMonitor", "test", method, data);
        }

        @Override
        public void resolve(JSObject value) {
            result = value;
            finished.countDown();
        }

        @Override
        public void reject(String message, String code) {
            error = code;
            finished.countDown();
        }

        @Override
        public void reject(String message, String code, Exception exception) {
            reject(message, code);
        }
    }
}
