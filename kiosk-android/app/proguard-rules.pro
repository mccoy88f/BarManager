# Proguard rules for BarManager Kiosk
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-dontwarn okhttp3.**
-dontwarn okio.**

