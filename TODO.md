# TODO.md

## Goal

Make Shiki code-block theme user-configurable. Two independent dropdowns in
Appearance settings (light + dark), defaulting to GitHub Light/Dark Default so
existing users see no behavior change. All 65 bundled Shiki themes available.

## Approach

1. State + persistence layer
   - Add `codeBlockThemeLight` / `codeBlockThemeDark` to `themeStore`
   - Storage keys, setters, normalize backup, export/import backup
2. Code-block theme catalog helper (`src/lib/codeBlockThemes.ts`)
   - Wrap `bundledThemesInfo` from `shiki/themes`
   - Default theme constants + validation/fallback
3. Worker lazy-load plumbing
   - `shikiWorker.ts`: use `bundledThemesInfo` for theme map, add `ensureTheme` on demand
   - `shikiWorkerClient.ts`: init preloads user's current 2 themes; new load-theme message type
4. Theme resolution
   - `shikiTheme.ts`: `getShikiTheme(isDark, light, dark)` — pick by isDark
   - `useSyntaxHighlight.ts`: 3 call sites pass user's configured themes
5. Settings UI
   - New `<SettingsSection>` in AppearanceSettings with two `<select>` dropdowns
   - Live preview rendering a small code sample with the chosen theme
6. i18n strings (en + zh-CN)
7. Tests update + typecheck + build green

## Current Step

All steps done — verifying with typecheck + tests + build before merge.
