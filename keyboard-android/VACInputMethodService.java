package com.vac.keyboard;

import android.content.Context;
import android.inputmethodservice.InputMethodService;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * VAC Input Method Service (Android IME)
 *
 * Adds a suggestion bar above the keyboard in every app.
 * Shows 4 AI suggestions (Natural / Thoughtful / Smart / Warm).
 * Tap a chip to insert it into the current text field.
 *
 * Setup: See README.md
 */
public class VACInputMethodService extends InputMethodService {

    // ── Config ────────────────────────────────────────────────────────────────
    private static final String PREF_NAME        = "vac_prefs";
    private static final String KEY_URL          = "server_url";
    private static final String KEY_CONTACT_NAME = "contact_name";
    private static final String DEFAULT_URL      = "http://192.168.1.220:8787";
    private static final long   DEBOUNCE_MS      = 550;

    // ── State ─────────────────────────────────────────────────────────────────
    private View              suggestionBar;
    private LinearLayout      chipContainer;
    private TextView          statusLabel;
    private View              loadingDots;

    private final Handler     mainHandler  = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private       Runnable    debounceTask;
    private       String      lastContext  = "";

    // ── InputMethodService lifecycle ──────────────────────────────────────────

    @Override
    public View onCreateInputView() {
        suggestionBar = LayoutInflater.from(this)
            .inflate(R.layout.keyboard_view, null);

        chipContainer = suggestionBar.findViewById(R.id.vac_chips);
        statusLabel   = suggestionBar.findViewById(R.id.vac_status);
        loadingDots   = suggestionBar.findViewById(R.id.vac_loading);

        setStatus("VAC ready");
        return suggestionBar;
    }

    @Override
    public void onStartInputView(EditorInfo info, boolean restarting) {
        super.onStartInputView(info, restarting);
        String current = getContextBefore();
        scheduleFetch(current);
    }

    @Override
    public void onUpdateSelection(int oldSelStart, int oldSelEnd,
                                  int newSelStart, int newSelEnd,
                                  int candidatesStart, int candidatesEnd) {
        super.onUpdateSelection(oldSelStart, oldSelEnd,
                                newSelStart, newSelEnd,
                                candidatesStart, candidatesEnd);
        String context = getContextBefore();
        if (!context.equals(lastContext)) {
            lastContext = context;
            scheduleFetch(context);
        }
    }

    @Override
    public void onFinishInput() {
        super.onFinishInput();
        clearChips();
        if (debounceTask != null) mainHandler.removeCallbacks(debounceTask);
    }

    // ── Fetch logic ───────────────────────────────────────────────────────────

    private void scheduleFetch(String context) {
        if (debounceTask != null) mainHandler.removeCallbacks(debounceTask);
        debounceTask = () -> fetchSuggestions(context);
        mainHandler.postDelayed(debounceTask, DEBOUNCE_MS);
    }

    private void fetchSuggestions(String draft) {
        showLoading(true);
        String serverURL   = getServerURL();
        String contactName = getContactName();

        executor.submit(() -> {
            List<VACChipData> suggestions = callAPI(serverURL, draft, contactName);
            mainHandler.post(() -> {
                showLoading(false);
                if (suggestions.isEmpty()) {
                    setStatus("Nothing to suggest");
                } else {
                    setStatus("");
                    renderChips(suggestions);
                }
            });
        });
    }

    private List<VACChipData> callAPI(String serverURL, String draft, String contactName) {
        List<VACChipData> result = new ArrayList<>();
        try {
            // Split contextBefore (full history) from draft (current sentence after last newline)
            String contextBefore = "";
            String currentDraft  = draft;
            int lastNL = draft.lastIndexOf('\n');
            if (lastNL >= 0) {
                contextBefore = draft.substring(0, lastNL);
                currentDraft  = draft.substring(lastNL + 1);
            }

            URL url = new URL(serverURL + "/api/keyboard/suggest");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            conn.setConnectTimeout(5_000);
            conn.setReadTimeout(10_000);

            boolean hasContact = contactName != null && !contactName.isEmpty();
            JSONObject body = new JSONObject();
            body.put("draft",         currentDraft);
            body.put("contextBefore", contextBefore);
            body.put("appContext",    "Android");
            body.put("profileKey",    hasContact ? contactName : "android-global");
            body.put("platform",      "android");
            if (hasContact) body.put("senderName", contactName);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
            }

            if (conn.getResponseCode() != 200) return result;

            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), "UTF-8"))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
            }

            JSONObject resp        = new JSONObject(sb.toString());
            JSONArray  suggestions = resp.optJSONArray("suggestions");
            if (suggestions == null) return result;

            for (int i = 0; i < suggestions.length(); i++) {
                JSONObject s    = suggestions.getJSONObject(i);
                String     text = s.optString("text", "");
                String     tone = s.optString("tone", "Natural");
                if (!text.isEmpty()) result.add(new VACChipData(tone, text));
            }
        } catch (Exception e) {
            // Network error — silent fail, keep suggestion bar clean
        }
        return result;
    }

    // ── Chip rendering ────────────────────────────────────────────────────────

    private void renderChips(List<VACChipData> chips) {
        chipContainer.removeAllViews();

        for (VACChipData chip : chips) {
            View chipView = LayoutInflater.from(this)
                .inflate(R.layout.chip_view, chipContainer, false);

            TextView toneLabel = chipView.findViewById(R.id.chip_tone);
            TextView textLabel = chipView.findViewById(R.id.chip_text);
            toneLabel.setText(chip.tone.toUpperCase());
            textLabel.setText(chip.text);

            final String suggestionText = chip.text;
            final String suggestionTone = chip.tone;

            chipView.setOnClickListener(v -> {
                insertText(suggestionText);
                sendLearnSignal(suggestionTone, suggestionText);
            });

            chipContainer.addView(chipView);
        }
    }

    private void clearChips() {
        if (chipContainer != null) chipContainer.removeAllViews();
    }

    // ── Text insertion ────────────────────────────────────────────────────────

    private void insertText(String text) {
        InputConnection ic = getCurrentInputConnection();
        if (ic == null) return;

        // Delete only the current sentence (after last newline), not full context
        CharSequence before = ic.getTextBeforeCursor(1000, 0);
        if (before != null && before.length() > 0) {
            String bs      = before.toString();
            int    lastNL  = bs.lastIndexOf('\n');
            int    toDelete = lastNL >= 0 ? bs.length() - lastNL - 1 : bs.length();
            if (toDelete > 0) ic.deleteSurroundingText(toDelete, 0);
        }
        ic.commitText(text, 1);
    }

    private String getContextBefore() {
        InputConnection ic = getCurrentInputConnection();
        if (ic == null) return "";
        CharSequence cs = ic.getTextBeforeCursor(600, 0);
        return cs != null ? cs.toString() : "";
    }

    // ── Learning ──────────────────────────────────────────────────────────────

    private void sendLearnSignal(String tone, String text) {
        String serverURL   = getServerURL();
        String contactName = getContactName();
        executor.submit(() -> {
            try {
                URL url = new URL(serverURL + "/api/keyboard/learn");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(3_000);
                conn.setReadTimeout(3_000);

                boolean hasContact = contactName != null && !contactName.isEmpty();
                JSONObject body = new JSONObject();
                body.put("profileKey", hasContact ? contactName : "android-global");
                body.put("tone",       tone);
                body.put("text",       text);
                body.put("platform",   "android");

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes("UTF-8"));
                }
                conn.getResponseCode(); // trigger send
            } catch (Exception ignored) {}
        });
    }

    // ── UI helpers ────────────────────────────────────────────────────────────

    private void setStatus(String text) {
        if (statusLabel == null) return;
        mainHandler.post(() -> {
            statusLabel.setText(text);
            statusLabel.setVisibility(text.isEmpty() ? View.GONE : View.VISIBLE);
        });
    }

    private void showLoading(boolean loading) {
        if (loadingDots == null || chipContainer == null) return;
        mainHandler.post(() -> {
            loadingDots.setVisibility(loading ? View.VISIBLE : View.GONE);
            chipContainer.setVisibility(loading ? View.GONE : View.VISIBLE);
        });
    }

    private String getServerURL() {
        return getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
            .getString(KEY_URL, DEFAULT_URL);
    }

    /** Contact/thread name — set by the containing app via shared prefs for cross-platform learning. */
    private String getContactName() {
        return getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
            .getString(KEY_CONTACT_NAME, "");
    }

    // ── Inner classes ─────────────────────────────────────────────────────────

    static class VACChipData {
        final String tone;
        final String text;
        VACChipData(String tone, String text) { this.tone = tone; this.text = text; }
    }
}
