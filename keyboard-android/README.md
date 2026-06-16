# VAC Android Keyboard (IME)

Adds a VAC suggestion bar above any Android keyboard in any app.

## Requirements

- Android Studio Hedgehog (2023.1.1) or newer
- Android 7.0+ device
- Mac running VAC (port 8787) on the same Wi-Fi

## Build Steps

### 1. Create a new Android project

1. Android Studio → New Project → Empty Activity
2. Package: `com.vac.keyboard`, Min SDK: 24

### 2. Copy source files

- Copy `VACInputMethodService.java` → `app/src/main/java/com/vac/keyboard/`
- Copy `res/layout/keyboard_view.xml` → `app/src/main/res/layout/`
- Copy `res/layout/chip_view.xml` → `app/src/main/res/layout/`
- Copy `res/xml/method.xml` → `app/src/main/res/xml/`
- Merge `AndroidManifest.xml` into your project's manifest

### 3. Set your Mac's IP

In `VACInputMethodService.java`, update:
```java
private static final String DEFAULT_URL = "http://YOUR_MAC_IP:8787";
```
Your Mac IP is shown in the VAC app → Settings → Phone & Extension.

### 4. Add drawables

Create `res/drawable/chip_background.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#FFFFFF" />
    <stroke android:width="1dp" android:color="#1A0071E3" />
    <corners android:radius="10dp" />
</shape>
```

Create `res/drawable/dot.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="oval">
    <solid android:color="#0071E3" />
    <size android:width="7dp" android:height="7dp" />
</shape>
```

### 5. Build APK

Build → Generate Signed Bundle / APK → APK, or run directly on device.

### 6. Enable the keyboard

1. Settings → General Management → Keyboard → On-screen keyboard → Add keyboard
2. Enable **VAC Keyboard**
3. In any app, switch to VAC keyboard via the keyboard selector icon
4. Start typing — suggestions appear automatically

## How it works

- Reads text before your cursor for context
- Sends to VAC API → gets 4 AI suggestions
- Tap any chip → replaces your text with that suggestion
- Sends a learning signal back so VAC improves over time
